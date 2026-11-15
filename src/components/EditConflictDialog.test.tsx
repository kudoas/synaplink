import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditConflictDialog } from "./EditConflictDialog";

describe(EditConflictDialog, () => {
  // oxlint-disable-next-line vitest/no-hooks -- A failed modal assertion must not leave document listeners or inert siblings behind.
  afterEach(() => { cleanup(); });

  it("選択肢ではなく見出しへfocusし、名前と説明を関連付ける", () => {
    render(<EditConflictDialog onAcceptExternal={vi.fn()} onOverwrite={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "外部でメモが変更されました" });

    expect(dialog).toHaveAccessibleDescription("現在の編集を残すか、外部で変更された内容を読み込んでください。");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "外部でメモが変更されました" }));
  });

  it("選択肢の中でTabとShift+Tabを循環させる", () => {
    render(<EditConflictDialog onAcceptExternal={vi.fn()} onOverwrite={vi.fn()} />);
    const first = screen.getByRole("button", { name: "外部の内容を読む" });
    const last = screen.getByRole("button", { name: "現在の編集で上書き" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("競合をEscapeで黙って閉じず、IME中のキーを操作へ読み替えない", () => {
    const accept = vi.fn();
    const overwrite = vi.fn();
    render(<EditConflictDialog onAcceptExternal={accept} onOverwrite={overwrite} />);
    const heading = screen.getByRole("heading");
    const escape = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
    const composingTab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, isComposing: true, key: "Tab" });
    fireEvent(heading, escape);
    fireEvent(heading, composingTab);

    expect({ composingPrevented: composingTab.defaultPrevented, escapePrevented: escape.defaultPrevented }).toStrictEqual({ composingPrevented: false, escapePrevented: true });
    expect(document.activeElement).toBe(heading);
    expect({ accepts: accept.mock.calls, overwrites: overwrite.mock.calls }).toStrictEqual({ accepts: [], overwrites: [] });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("各選択肢はfocus後に通常どおり操作できる", () => {
    const accept = vi.fn();
    const overwrite = vi.fn();
    render(<EditConflictDialog onAcceptExternal={accept} onOverwrite={overwrite} />);
    fireEvent.click(screen.getByRole("button", { name: "外部の内容を読む" }));
    fireEvent.click(screen.getByRole("button", { name: "現在の編集で上書き" }));

    expect({ accepts: accept.mock.calls.length, overwrites: overwrite.mock.calls.length }).toStrictEqual({ accepts: 1, overwrites: 1 });
  });

  it("背面をinertにし、外部からのfocusもダイアログへ戻す", () => {
    const background = render(<button>背面の操作</button>);
    const behind = screen.getByRole("button", { name: "背面の操作" });
    render(<EditConflictDialog onAcceptExternal={vi.fn()} onOverwrite={vi.fn()} />);
    behind.focus();

    expect(background.container).toHaveAttribute("inert");
    expect(background.container).toHaveAttribute("aria-hidden", "true");
    expect(document.activeElement).toBe(screen.getByRole("heading"));
  });

  it("開発時のStrictModeでも元の属性と編集欄focusを復元しlistenerを残さない", () => {
    const background = render(<><input aria-label="編集欄" /><button>他の操作</button></>);
    background.container.setAttribute("aria-hidden", "false");
    const editor = screen.getByRole("textbox", { name: "編集欄" });
    const other = screen.getByRole("button", { name: "他の操作" });
    editor.focus();
    const modal = render(<StrictMode><EditConflictDialog onAcceptExternal={vi.fn()} onOverwrite={vi.fn()} /></StrictMode>);
    modal.unmount();

    expect({ hidden: background.container.getAttribute("aria-hidden"), inert: background.container.getAttribute("inert") }).toStrictEqual({ hidden: "false", inert: null });
    expect(document.activeElement).toBe(editor);
    other.focus();
    expect(document.activeElement).toBe(other);
  });

  it.each(["disabled", "removed"])("復帰先が%sなら利用できる背面操作へfocusを戻す", (state) => {
    const background = render(<><button>代わりの操作</button><input aria-label="編集欄" /></>);
    const editor = screen.getByRole<HTMLInputElement>("textbox", { name: "編集欄" });
    const fallback = screen.getByRole("button", { name: "代わりの操作" });
    editor.focus();
    const modal = render(<EditConflictDialog onAcceptExternal={vi.fn()} onOverwrite={vi.fn()} />);
    // oxlint-disable-next-line vitest/no-conditional-in-test -- Each row prepares a different unavailable target for the same restoration contract.
    if (state === "disabled") { editor.disabled = true; } else { background.rerender(<button>代わりの操作</button>); }
    modal.unmount();

    expect(document.activeElement).toBe(fallback);
    expect(background.container).not.toHaveAttribute("inert");
  });

  it("既にあるinert属性は解除しない", () => {
    const background = render(<button>既に無効な領域</button>);
    background.container.setAttribute("inert", "original");
    background.container.setAttribute("aria-hidden", "true");
    const modal = render(<EditConflictDialog onAcceptExternal={vi.fn()} onOverwrite={vi.fn()} />);
    modal.unmount();

    expect({ hidden: background.container.getAttribute("aria-hidden"), inert: background.container.getAttribute("inert") }).toStrictEqual({ hidden: "true", inert: "original" });
  });
});
