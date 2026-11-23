import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface Props {
  onAcceptExternal: () => void;
  onOverwrite: () => void;
}

export function EditConflictDialog({ onAcceptExternal, onOverwrite }: Props) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const { current } = dialog;
    const { current: overlay } = backdrop;
    const { current: dialogHeading } = heading;
    if (!current || !overlay) {
      return;
    }
    const previousFocus = document.activeElement;
    const background = [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => ({ element, hidden: element.getAttribute("aria-hidden"), inert: element.getAttribute("inert") }));
    // Neither choice is a harmless default: Enter must not discard either version.
    dialogHeading?.focus();
    for (const { element } of background) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !current.contains(event.target)) {
        dialogHeading?.focus();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.key === "Escape") {
        // A conflict has no non-destructive default dismissal.
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const buttons: HTMLElement[] = [...current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        if (buttons.length === 0) {
          dialogHeading?.focus();
          return;
        }
        const focused = document.activeElement;
        const index = focused instanceof HTMLElement ? buttons.indexOf(focused) : -1;
        const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
        buttons[next].focus();
      }
    };
    const isAvailable = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return element.isConnected && !overlay.contains(element) && !element.matches(":disabled") &&
        !element.closest("[inert], [hidden], [aria-hidden='true']") && style.display !== "none" && style.visibility !== "hidden";
    };
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", handleKey, true);
      for (const { element, hidden, inert } of background) {
        if (inert === null) { element.removeAttribute("inert"); } else { element.setAttribute("inert", inert); }
        if (hidden === null) { element.removeAttribute("aria-hidden"); } else { element.setAttribute("aria-hidden", hidden); }
      }
      const canRestore = previousFocus instanceof HTMLElement && isAvailable(previousFocus);
      if (canRestore) {
        previousFocus.focus();
      }
      if (!canRestore || document.activeElement !== previousFocus) {
        const fallback = [...document.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']")]
          .find((element) => isAvailable(element));
        fallback?.focus();
      }
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" ref={backdrop}>
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal"
        ref={dialog}
        role="dialog"
      >
        <h2 id={titleId} ref={heading} tabIndex={-1}>外部でメモが変更されました</h2>
        <p id={descriptionId}>現在の編集を残すか、外部で変更された内容を読み込んでください。</p>
        <div className="modal-actions">
          <button onClick={onAcceptExternal}>外部の内容を読む</button>
          <button onClick={onOverwrite}>
            現在の編集で上書き
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
