import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ShutdownRequest {
  id: string;
}

export const shutdownApi = {
  cancel: async (requestId: string) => invoke<void>("cancel_shutdown", { requestId }),
  complete: async (requestId: string) => invoke<void>("complete_shutdown", { requestId }),
  isNative: isTauri,
  listen: async (handler: (request: ShutdownRequest) => void) =>
    listen<ShutdownRequest>("synaplink://shutdown-requested", (event) => { handler(event.payload); }),
  register: async () => invoke<ShutdownRequest | null>("register_shutdown_guard"),
};
