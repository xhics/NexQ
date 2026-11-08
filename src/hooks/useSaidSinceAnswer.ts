import { useEffect, useState } from "react";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { contentWords } from "../stores/storyStore";

// Your lines are labelled "User" (the "You" party).
const isYou = (speaker: string) => speaker === "User";

/**
 * The words you have said since the current answer started, so the parts of
 * it you already covered can be struck out. Empty between answers.
 */
export function useSaidSinceAnswer(): Set<string> {
  const [said, setSaid] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let request = useStreamStore.getState().requestStartedAt;
    // Your lines when the answer started, and how much of each was said by then.
    let before = new Map<string, number>();
    const snapshot = () => {
      before = new Map(useTranscriptStore.getState().segments.filter((s) => isYou(s.speaker)).map((s) => [s.id, s.text.length]));
    };
    snapshot();
    let lastText = "";

    const update = () => {
      const started = useStreamStore.getState().requestStartedAt;
      if (started !== request) {
        request = started;
        snapshot();
      }
      const text = useTranscriptStore
        .getState()
        .segments.filter((s) => isYou(s.speaker))
        .map((s) => s.text.slice(before.get(s.id) ?? 0))
        .join(" ");
      if (text === lastText) return;
      lastText = text;
      setSaid(contentWords(text));
    };
    const a = useStreamStore.subscribe(update);
    const b = useTranscriptStore.subscribe(update);
    return () => { a(); b(); };
  }, []);

  return said;
}

/** Whether you have said most of `text` (at least two of its words, and 60 %). */
export function covered(text: string, said: Set<string>): boolean {
  if (said.size === 0) return false;
  const words = contentWords(text);
  if (words.size === 0) return false;
  let hit = 0;
  for (const w of words) if (said.has(w)) hit++;
  return words.size === 1 ? hit === 1 : hit >= 2 && hit / words.size >= 0.6;
}
