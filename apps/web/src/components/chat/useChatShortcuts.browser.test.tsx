import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { focusSideChatPaneOnClick } from "~/lib/sideChatPane";
import { isPreviewFocused } from "~/lib/previewFocus";
import { surfaceShortcutKey } from "~/lib/surfaceShortcutKey";
import { render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { useChatShortcuts } from "./useChatShortcuts";

const shortcutContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: true,
  isDesktop: false,
  modelPickerOpen: false,
};

const focusOnMount = (element: HTMLElement | null) => element?.focus();

// Stands in for the right panel's launcher, which needs the whole app around it. Like the
// real one it takes focus, advertises its letters in `data-surface-launcher-keys`, and
// claims one from its own window capture listener unless the key was already handled.
function Launcher(props: { keys: string; received: string[] }) {
  useEffect(() => {
    const claim = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = surfaceShortcutKey(event);
      if (key === null || !props.keys.toLowerCase().includes(key)) return;
      event.preventDefault();
      props.received.push(event.key);
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [props.keys, props.received]);
  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      aria-label="Open a surface"
      data-surface-launcher-keys={props.keys}
    />
  );
}

// The chat's shortcut listener registers when the chat mounts, so a launcher that opens
// later registers after it. Tests mount the chat first and add the launcher by rerendering.
function Chat(props: { composerKeys: string[]; launcher?: { keys: string; received: string[] } }) {
  useChatShortcuts({
    enabled: true,
    keybindings: [],
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: false,
    // Type-to-focus only calls insertTextAtEnd, so the stand-in composer implements just that.
    composerRef: {
      current: {
        insertTextAtEnd: (key: string) => {
          props.composerKeys.push(key);
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {},
    fallback: () => undefined,
  });
  return props.launcher ? <Launcher {...props.launcher} /> : null;
}

// router: false because the chat shortcuts and the launcher stand-in never navigate.
const options = { router: false } as const;

it("leaves the launcher's letters to the launcher, in either case", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("tT");

  expect(received).toEqual(["t", "T"]);
  expect(composerKeys).toEqual([]);
});

it("still types other letters into the composer while the launcher is open", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("a");

  expect(composerKeys).toEqual(["a"]);
  expect(received).toEqual([]);
});

it("leaves a non-Latin launcher letter to the launcher by its physical key", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  // Playwright cannot press a key its US layout lacks, so send what a Ukrainian T key sends.
  const event = new KeyboardEvent("keydown", {
    key: "\u0435",
    code: "KeyT",
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);

  expect(composerKeys).toEqual([]);
  expect(received).toEqual(["\u0435"]);
});

it.each([
  { key: "b", code: "KeyN", composer: [], launcher: ["b"] },
  { key: "x", code: "KeyB", composer: ["x"], launcher: [] },
  { key: "è", code: "KeyT", composer: ["è"], launcher: [] },
])("routes $key on $code by the typed letter", async ({ key, code, composer, launcher }) => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);

  expect(composerKeys).toEqual(composer);
  expect(received).toEqual(launcher);
});

const ctrlShift = (key: string, command: KeybindingCommand) => ({
  command,
  shortcut: { key, metaKey: false, ctrlKey: true, shiftKey: true, altKey: false, modKey: false },
});
const sideChatKeybindings: ResolvedKeybindingsConfig = [
  ctrlShift("m", "modelPicker.toggle"),
  ctrlShift("x", "thread.stop"),
  ...compileResolvedKeybindingsConfig([
    {
      key: "f18",
      command: "composer.decreaseEffort",
      when: "!terminalFocus && !modelPickerOpen && (!previewFocus || composerFocus)",
    },
    {
      key: "f19",
      command: "composer.increaseEffort",
      when: "!terminalFocus && !modelPickerOpen && (!previewFocus || composerFocus)",
    },
    {
      key: "f20",
      command: "composer.resetEffort",
      when: "!terminalFocus && !modelPickerOpen && (!previewFocus || composerFocus)",
    },
  ]),
];

// A side chat in the main chat's panel: no window listeners, only its composer's own chords.
function SideChat(props: { toggles: string[]; stops: string[]; steps?: number[] }) {
  const [composerElement, setComposerElement] = useState<HTMLDivElement | null>(null);
  useChatShortcuts({
    enabled: false,
    embedded: true,
    composerElement,
    keybindings: sideChatKeybindings,
    scriptKeybindings: [],
    getShortcutContext: () => ({
      ...shortcutContext,
      previewFocus: isPreviewFocused(),
      composerFocus: document.activeElement?.getAttribute("data-testid") === "composer-editor",
    }),
    threadFindActive: false,
    composerRef: {
      current: {
        toggleModelPicker: () => props.toggles.push("model"),
        stepReasoningEffort: (direction: -1 | 0 | 1) => props.steps?.push(direction),
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: { "thread.stop": () => void props.stops.push("stop") },
    fallback: () => undefined,
  });
  return (
    <>
      <div data-preview-panel-mode="inline">
        <div
          data-side-chat-pane
          tabIndex={-1}
          aria-label="Side chat page"
          onClickCapture={focusSideChatPaneOnClick}
        >
          <p>Side chat reply</p>
          <button type="button">Side chat action</button>
          <div ref={setComposerElement}>
            <textarea aria-label="Side chat composer" data-testid="composer-editor" />
          </div>
        </div>
      </div>
      <textarea aria-label="Main composer" />
      <div data-preview-panel-mode="inline">
        <textarea aria-label="Document preview" />
      </div>
    </>
  );
}

it("runs a side chat's composer chords only from its composer, and never thread commands", async () => {
  const toggles: string[] = [];
  const stops: string[] = [];
  await using screen = await render(<SideChat toggles={toggles} stops={stops} />, options);

  await userEvent.click(screen.getByLabelText("Side chat composer"));
  await userEvent.keyboard("{Control>}{Shift>}MX{/Shift}{/Control}");
  await userEvent.click(screen.getByLabelText("Main composer"));
  await userEvent.keyboard("{Control>}{Shift>}M{/Shift}{/Control}");

  expect(toggles).toEqual(["model"]);
  expect(stops).toEqual([]);
});

function MainReasoningShortcuts(props: { steps: number[] }) {
  useChatShortcuts({
    enabled: true,
    keybindings: sideChatKeybindings,
    scriptKeybindings: [],
    getShortcutContext: () => ({ ...shortcutContext, previewFocus: isPreviewFocused() }),
    threadFindActive: false,
    composerRef: {
      current: {
        stepReasoningEffort: (direction: -1 | 0 | 1) => props.steps.push(direction),
        toggleModelPicker: () => {},
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {},
    fallback: () => undefined,
  });
  return null;
}

it("routes reasoning keys to the clicked side chat page without changing the main chat", async () => {
  const toggles: string[] = [],
    stops: string[] = [],
    side: number[] = [],
    main: number[] = [];
  await using screen = await render(
    <>
      <MainReasoningShortcuts steps={main} />
      <SideChat toggles={toggles} stops={stops} steps={side} />
    </>,
    options,
  );
  await userEvent.click(screen.getByText("Side chat reply"));
  expect(document.activeElement).toBe(document.querySelector("[data-side-chat-pane]"));
  for (const key of ["F18", "F19", "F20"]) {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
    );
  }
  await userEvent.keyboard("{Control>}{Shift>}MX{/Shift}{/Control}");
  expect(side).toEqual([-1, 1, 0]);
  expect(main).toEqual([]);
  expect(toggles).toEqual([]);
  expect(stops).toEqual([]);
  await userEvent.click(screen.getByLabelText("Main composer"));
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "F19", code: "F19", bubbles: true, cancelable: true }),
  );
  expect(main).toEqual([1]);
  expect(side).toEqual([-1, 1, 0]);
  await userEvent.click(screen.getByLabelText("Document preview"));
  expect(isPreviewFocused()).toBe(true);
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "F19", code: "F19", bubbles: true, cancelable: true }),
  );
  expect(main).toEqual([1]);
  expect(side).toEqual([-1, 1, 0]);
  await userEvent.click(screen.getByRole("button", { name: "Side chat action" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Side chat action" }).element(),
  );
});
