import { useEffect, useState } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";

/** From this long, an answer is getting long (amber); from the second, too long (red). */
export const ANSWER_LONG_MS = 90_000;
export const ANSWER_TOO_LONG_MS = 120_000;
/** Your turn is over once you have been quiet this long. */
const TURN_GAP_MS = 6_000;

const isOtherParty = (speaker: string) => speaker === "Them" || speaker === "Interviewer";

/**
 * How long you have been answering: from your first words after the other
 * party last spoke, while you keep talking. Null when you aren't answering.
 */
export function useAnswerTimer(): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    let turnStart: number | null = null;
    let lastYouAt = 0;
    let lastKey = "";
    const onSegments = (segments: ReturnType<typeof useTranscriptStore.getState>["segments"]) => {
      const last = segments[segments.length - 1];
      if (!last) return;
      const key = `${last.id}:${last.text.length}`;
      if (key === lastKey) return;
      lastKey = key;
      if (isOtherParty(last.speaker)) {
        turnStart = null;
        return;
      }
      const now = Date.now();
      if (turnStart === null || now - lastYouAt > TURN_GAP_MS) turnStart = now;
      lastYouAt = now;
    };
    onSegments(useTranscriptStore.getState().segments);
    const unsubscribe = useTranscriptStore.subscribe((s) => onSegments(s.segments));
    const timer = setInterval(() => {
      const now = Date.now();
      setElapsed(turnStart !== null && now - lastYouAt <= TURN_GAP_MS ? now - turnStart : null);
    }, 500);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return elapsed;
}

/** "1:05" */
export function formatAnswerTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function answerTimeColor(ms: number): string {
  if (ms >= ANSWER_TOO_LONG_MS) return "text-red-400";
  if (ms >= ANSWER_LONG_MS) return "text-amber-300";
  return "text-white/60";
}
