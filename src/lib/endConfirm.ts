// Ending a meeting takes two presses (Ctrl+M twice, or End then Confirm), so
// a stray key or click never cuts an interview short.

import { emit, listen } from "@tauri-apps/api/event";

/** How long the first press waits for the second. */
export const END_CONFIRM_MS = 3000;

/** True when a press at `now` confirms the press at `armedAt`. */
export function confirmsEnd(armedAt: number | null, now: number): boolean {
  return armedAt !== null && now - armedAt >= 0 && now - armedAt <= END_CONFIRM_MS;
}

const END_ARMED_EVENT = "nexq:end_meeting_armed";

/** Tells every window that Ctrl+M was pressed once (the overlay shows it). */
export function emitEndArmed(): Promise<void> {
  return emit(END_ARMED_EVENT);
}

export function onEndArmed(handler: () => void): Promise<() => void> {
  return listen(END_ARMED_EVENT, () => handler());
}
