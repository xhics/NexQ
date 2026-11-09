// Keyboard shortcuts of the live meeting overlay. Single keys (B, S, K) only
// open panels or add a bookmark, outside inputs; muting your mic takes
// Ctrl+Shift+M, so a word typed into the wrong window never cuts the mic.
// Escape always closes the panels. Ctrl+B belongs to the global show / hide
// overlay shortcut, so bookmarks are B.

import { useEffect } from "react";
import { useMeetingStore } from "../stores/meetingStore";

interface ShortcutActions {
  addBookmark: () => void;
  toggleStats: () => void;
  toggleBookmarks: () => void;
  toggleMute: () => void;
  closeAllPanels: () => void;
  toggleDevLog: () => void;
}

export function useMeetingShortcuts(actions: ShortcutActions) {
  const isRecording = useMeetingStore((s) => s.isRecording);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isRecording) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Escape always works (even in inputs) — close all panels
      if (e.key === "Escape") {
        actions.closeAllPanels();
        return;
      }

      // Ctrl+Shift+M: mute / unmute your mic
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        actions.toggleMute();
        return;
      }

      // Ctrl+Shift+L: dev log (consolidated from OverlayView inline handler)
      if (e.ctrlKey && e.shiftKey && e.key === "L") {
        e.preventDefault();
        actions.toggleDevLog();
        return;
      }

      // Single-key shortcuts only outside inputs, and never with a modifier
      if (isInput || e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "b":
          actions.addBookmark();
          break;
        case "s":
          actions.toggleStats();
          break;
        case "k":
          actions.toggleBookmarks();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isRecording, actions]);
}
