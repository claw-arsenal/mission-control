"use client";

import { useEffect } from "react";

export type KanbanShortcutHandlers = {
  /** `n`: start a new ticket where the reader is working. */
  onNewTicket?: () => void;
  /** `/`: move focus to the ticket search field. */
  onFocusSearch?: () => void;
  /** `?`: show or hide the shortcut reference. */
  onToggleHelp?: () => void;
};

export const KANBAN_SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "n", description: "Add a ticket to the first list" },
  { keys: "/", description: "Search tickets" },
  { keys: "?", description: "Show this reference" },
  { keys: "Esc", description: "Close the composer or cancel a drag" },
  { keys: "Space", description: "Pick up or drop a focused card or list" },
  { keys: "↑ ↓ ← →", description: "Move a picked-up card or list" },
];

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

const hasOpenDialog = () => Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'));

/**
 * Single-key board shortcuts. They stay quiet while the reader is typing, holding
 * a modifier key, or has a dialog or menu open, so they never hijack normal input.
 */
export function useKanbanShortcuts(handlers: KanbanShortcutHandlers, enabled = true) {
  const { onNewTicket, onFocusSearch, onToggleHelp } = handlers;

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || hasOpenDialog()) return;

      if (event.key === "n" && onNewTicket) {
        event.preventDefault();
        onNewTicket();
      } else if (event.key === "/" && onFocusSearch) {
        event.preventDefault();
        onFocusSearch();
      } else if (event.key === "?" && onToggleHelp) {
        event.preventDefault();
        onToggleHelp();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onNewTicket, onFocusSearch, onToggleHelp]);
}
