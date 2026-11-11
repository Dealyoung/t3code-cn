import type { OrchestrationV2ThreadShell, ScopedThreadRef } from "@t3tools/contracts";

import type { ToolCallDiffTarget } from "../diffPanelStore";
import { useRightPanelStore } from "../rightPanelStore";

/** Whether an event started in the side chat pane (`data-side-chat-pane`), which the main chat ignores. */
export function isInSideChatPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-side-chat-pane]") !== null;
}

/** Give non-interactive side-chat content a keyboard target without taking editor or control focus. */
export function focusSideChatPaneOnClick(event: {
  readonly button: number;
  readonly target: EventTarget | null;
  readonly currentTarget: HTMLElement;
}): void {
  if (event.button !== 0) return;
  if (
    event.target instanceof Element &&
    event.target.closest(
      'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"]',
    ) !== null
  )
    return;
  event.currentTarget.focus({ preventScroll: true });
}

/**
 * Opens an embedded side chat's tool diffs in its parent's diff panel and runs its shell commands
 * in the parent's terminal drawer, since the embedded view hides its own. Other panel actions reach
 * the parent through `hostRightPanel`; diff selection and the drawer are not panel state.
 */
export interface SideChatParentPanel {
  readonly openToolDiff: (target: ToolCallDiffTarget) => void;
  readonly runShellCommand: (command: string) => void;
}

/** Opens `thread` in its tab when it is a side chat of `parentRef`; false for any other thread. */
export function openSideChatTab(
  parentRef: ScopedThreadRef,
  thread: Pick<OrchestrationV2ThreadShell, "id" | "lineage"> | null,
): boolean {
  if (thread?.lineage.sideChat !== true || thread.lineage.parentThreadId !== parentRef.threadId) {
    return false;
  }
  useRightPanelStore.getState().openSideChat(parentRef, thread.id);
  return true;
}
