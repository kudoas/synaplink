use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, Window, WindowEvent};
use uuid::Uuid;

const REQUEST_EVENT: &str = "synaplink://shutdown-requested";
pub const QUIT_MENU_ID: &str = "synaplink-quit-after-save";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShutdownRequest {
    id: String,
}

#[derive(Default)]
struct ShutdownGate {
    registered: bool,
    pending: Option<ShutdownRequest>,
    approved: bool,
}

impl ShutdownGate {
    const fn blocks_exit(&self) -> bool {
        self.registered && !self.approved
    }

    fn request(&mut self) -> Option<ShutdownRequest> {
        if !self.blocks_exit() {
            return None;
        }
        Some(
            self.pending
                .get_or_insert_with(|| ShutdownRequest {
                    id: Uuid::new_v4().to_string(),
                })
                .clone(),
        )
    }

    fn register(&mut self) -> Option<ShutdownRequest> {
        self.registered = true;
        self.pending.clone()
    }

    fn cancel(&mut self, id: &str) {
        if self
            .pending
            .as_ref()
            .is_some_and(|request| request.id == id)
        {
            self.pending = None;
        }
    }

    fn approve(&mut self, id: &str) -> Result<(), String> {
        if self.pending.as_ref().is_none_or(|request| request.id != id) {
            return Err("終了要求が更新されたため、終了を中止しました".to_string());
        }
        self.approved = true;
        self.pending = None;
        Ok(())
    }
}

#[derive(Default)]
pub struct ShutdownState(Mutex<ShutdownGate>);

fn is_blocked(app: &AppHandle) -> bool {
    // A poisoned state must not discard an editor whose contents are unknown.
    app.state::<ShutdownState>()
        .0
        .lock()
        .map_or(true, |gate| gate.blocks_exit())
}

pub fn request_shutdown(app: &AppHandle) {
    let request = app
        .state::<ShutdownState>()
        .0
        .lock()
        .ok()
        .and_then(|mut gate| gate.request());
    if let Some(request) = request {
        // Keep the request in state even if the listener is not yet registered.
        // The frontend receives it from register_shutdown_guard after listening.
        app.emit_to("main", REQUEST_EVENT, request).ok();
    } else if !is_blocked(app) {
        app.exit(0);
    }
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if is_blocked(window.app_handle()) {
            api.prevent_close();
            request_shutdown(window.app_handle());
        }
    }
}

pub fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = event {
        if is_blocked(app) {
            api.prevent_exit();
            request_shutdown(app);
        }
    }
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("このウィンドウからは終了を操作できません".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn register_shutdown_guard(
    window: WebviewWindow,
    state: State<'_, ShutdownState>,
) -> Result<Option<ShutdownRequest>, String> {
    ensure_main_window(&window)?;
    state
        .0
        .lock()
        .map_err(|_| "終了時保存の準備ができません".to_string())
        .map(|mut gate| gate.register())
}

#[tauri::command]
pub fn cancel_shutdown(
    window: WebviewWindow,
    request_id: String,
    state: State<'_, ShutdownState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    state
        .0
        .lock()
        .map_err(|_| "終了要求を取り消せません".to_string())?
        .cancel(&request_id);
    Ok(())
}

#[tauri::command]
pub fn complete_shutdown(
    window: WebviewWindow,
    request_id: String,
    app: AppHandle,
    state: State<'_, ShutdownState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    state
        .0
        .lock()
        .map_err(|_| "終了要求を確認できません".to_string())?
        .approve(&request_id)?;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn install_quit_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};

    let menu = Menu::default(app)?;
    let app_menu = menu
        .items()?
        .first()
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| std::io::Error::other("アプリのメニューを取得できません"))?;
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    let mut position = None;
    for (index, item) in app_menu.items()?.iter().enumerate() {
        if let MenuItemKind::Predefined(item) = item {
            if item.text()? == quit_text {
                position = Some(index);
                break;
            }
        }
    }
    let index = position.ok_or_else(|| std::io::Error::other("終了メニューを取得できません"))?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, quit_text, true, Some("CmdOrCtrl+Q"))?;
    app_menu.remove_at(index)?;
    app_menu.insert(&quit, index)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ShutdownGate;

    #[test]
    fn startup_can_close_until_the_editor_is_registered() {
        let mut gate = ShutdownGate::default();
        assert!(!gate.blocks_exit());
        assert!(gate.request().is_none());
        assert!(gate.register().is_none());
        assert!(gate.blocks_exit());
    }

    #[test]
    fn repeated_requests_keep_the_same_id_until_cancelled() {
        let mut gate = ShutdownGate::default();
        gate.register();
        let first = gate.request().unwrap();
        assert_eq!(gate.request(), Some(first.clone()));
        gate.cancel("stale-request");
        assert_eq!(gate.request(), Some(first.clone()));
        gate.cancel(&first.id);
        let retry = gate.request().unwrap();
        assert_ne!(retry.id, first.id);
        assert!(gate.approve(&first.id).is_err());
        assert!(gate.blocks_exit());
    }

    #[test]
    fn registration_recovers_a_request_missed_by_the_listener() {
        let mut gate = ShutdownGate::default();
        gate.register();
        let request = gate.request().unwrap();
        assert_eq!(gate.register(), Some(request));
        assert!(gate.blocks_exit());
    }

    #[test]
    fn only_the_matching_completed_request_allows_exit() {
        let mut gate = ShutdownGate::default();
        gate.register();
        let request = gate.request().unwrap();
        assert!(gate.approve("unrelated").is_err());
        assert!(gate.blocks_exit());
        gate.approve(&request.id).unwrap();
        assert!(!gate.blocks_exit());
        assert!(gate.request().is_none());
    }
}
