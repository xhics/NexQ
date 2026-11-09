// Adds a bookmark at the current offset of the meeting. The B key
// (useMeetingShortcuts) and the toolbar call the function it returns; Ctrl+B
// is the global show / hide overlay shortcut.

import { useCallback } from "react";
import { useMeetingStore } from "../stores/meetingStore";
import { useBookmarkStore } from "../stores/bookmarkStore";
import { showBookmarkToast } from "../overlay/BookmarkToast";

export function useBookmarkHotkey(): () => void {
  const isRecording = useMeetingStore((s) => s.isRecording);
  const meetingStartTime = useMeetingStore((s) => s.meetingStartTime);
  const addBookmark = useBookmarkStore((s) => s.addBookmark);

  const addBookmarkAtNow = useCallback(() => {
    if (!isRecording || !meetingStartTime) return;
    const offsetMs = Date.now() - meetingStartTime;
    const bookmark = addBookmark(offsetMs);
    showBookmarkToast(bookmark.id, offsetMs);
  }, [isRecording, meetingStartTime, addBookmark]);

  return addBookmarkAtNow;
}
