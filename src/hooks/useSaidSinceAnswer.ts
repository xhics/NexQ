import { useEffect, useState } from "react";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { contentWords } from "../stores/storyStore";

// Your lines are labelled "User" (the "You" party).
const isYou = (speaker: string) => speaker === "User";

/**
 * A line of yours as shown, interim words included: a transcriber that
 * finalizes by turn (Flux) gives the final text only once you stop, which
 * would hold the marks back for as long as you read.
 */
const shown = (s: { text: string; pending_text?: string }) => s.pending_text?.trim() || s.text;

/** How many words you have said since the current answer started. */
let spokenCount = 0;

/** How many words (any, not only content words) you have said since the answer on screen started. */
export function wordsSaidSinceAnswer(): number {
  return spokenCount;
}

/**
 * The words you have said since the current answer started, so the parts of
 * it you already covered can be struck out. Empty between answers.
 */
export function useSaidSinceAnswer(): Set<string> {
  const [said, setSaid] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let request = useStreamStore.getState().answerSince;
    // Your lines when the answer started, and how much of each was said by then.
    let before = new Map<string, number>();
    const snapshot = () => {
      before = new Map(useTranscriptStore.getState().segments.filter((s) => isYou(s.speaker)).map((s) => [s.id, shown(s).length]));
    };
    snapshot();
    let lastText = "";

    const update = () => {
      // A continuation keeps answerSince: what you said of its start stays marked.
      const started = useStreamStore.getState().answerSince;
      if (started !== request) {
        request = started;
        snapshot();
      }
      const text = useTranscriptStore
        .getState()
        .segments.filter((s) => isYou(s.speaker))
        .map((s) => shown(s).slice(before.get(s.id) ?? 0))
        .join(" ");
      if (text === lastText) return;
      lastText = text;
      spokenCount = text.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      setSaid(contentWords(text));
    };
    const a = useStreamStore.subscribe(update);
    const b = useTranscriptStore.subscribe(update);
    return () => { a(); b(); };
  }, []);

  return said;
}

/** Words this long are the same word when they start alike ("déploiement", "déployer" no; "résilience", "résiliente" yes). */
const STEM = 6;
const stemsOf = new WeakMap<Set<string>, Set<string>>();

/** The said words' stems, worked out once per set. */
function stems(said: Set<string>): Set<string> {
  let s = stemsOf.get(said);
  if (!s) {
    s = new Set([...said].filter((w) => w.length >= STEM).map((w) => w.slice(0, STEM)));
    stemsOf.set(said, s);
  }
  return s;
}

/** Whether `word` was said: as is, or with another ending (a plural, a mis-heard ending). */
function wasSaid(word: string, said: Set<string>): boolean {
  return said.has(word) || (word.length >= STEM && stems(said).has(word.slice(0, STEM)));
}

/**
 * Whether you have said most of `text`: at least two of its words, and half
 * of them. Words count with another ending too, as the transcriber or your
 * own wording may change it.
 */
export function covered(text: string, said: Set<string>): boolean {
  if (said.size === 0) return false;
  const words = contentWords(text);
  if (words.size === 0) return false;
  let hit = 0;
  for (const w of words) if (wasSaid(w, said)) hit++;
  return words.size === 1 ? hit === 1 : hit >= 2 && hit / words.size >= 0.5;
}

const plainWords = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * `text` cut where you pause: after a comma, a semicolon, a colon or a full
 * stop (not inside a number like 3,5), each piece keeping its punctuation and
 * the space after it.
 */
export function clauses(text: string): string[] {
  return text.match(/[^]+?(?:[.,;:!?…]+(?=\s|$)\s*|$)/gu) ?? [text];
}

/**
 * What of `answer` (markdown) you have said, read in order: the pieces (up to
 * a comma) up to the last one you said, those you said in your own words included.
 * Returns whether a piece of the answer is in it.
 */
export function saidInOrder(answer: string, said: Set<string>): (piece: string) => boolean {
  if (said.size === 0) return () => false;
  const plain = answer
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, "")
    .replace(/[*_`#>]/gu, "");
  const units = plain.split("\n").flatMap((line) => (line.trim() ? clauses(line) : []));
  let last = -1;
  units.forEach((u, i) => { if (covered(u, said)) last = i; });
  const before = last < 0 ? "" : plainWords(units.slice(0, last + 1).join(" "));
  return (piece) => {
    if (covered(piece, said)) return true;
    const words = plainWords(piece);
    return words.length >= 2 && before.includes(words);
  };
}
