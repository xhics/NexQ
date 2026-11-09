import { useEffect, useMemo, useRef, type RefObject } from "react";
import { OTHER_PARTY_QUIET_MS, otherPartyQuiet, youQuiet } from "../lib/otherPartySpeech";
import { wordsSaidSinceAnswer } from "./useSaidSinceAnswer";

/**
 * How long the text stays still before it moves on its own: from when it
 * shows, and from the other party's last word, whichever comes later.
 */
export const READING_START_DELAY_MS = 8000;
/** After your own scroll, the text stays where you put it this long. */
const MANUAL_HOLD_MS = 5000;
/** How fast the text catches up with what you have said (px/s, at least). */
const FOLLOW_MIN_SPEED = 80;
/**
 * Where the word you are at sits in the box (share of its height), so the
 * lines still to say stay in view below it.
 */
const READ_LINE = 0.3;
/** Part of your words counted as read: "euh", repeats and asides don't run it ahead of you. */
const SPOKEN_SHARE = 0.85;

/** Handlers to put on the scrolled element. */
export interface ReadingScrollHandlers {
  onWheel: () => void;
  onTouchMove: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export interface ReadingScrollSignals {
  /** The other party has finished talking. */
  otherQuiet: () => boolean;
  /** You aren't speaking (reading the answer out). */
  youQuiet: () => boolean;
  /** How many words you have said since the answer showed. */
  wordsSaid?: () => number;
}

const LIVE_SIGNALS: ReadingScrollSignals = {
  otherQuiet: () => otherPartyQuiet(),
  youQuiet: () => youQuiet(),
  wordsSaid: () => wordsSaidSinceAnswer(),
};

/**
 * Where to scroll to keep up with what you have said: the end of the last
 * part marked `data-said` (yellow), near the top, so what is left to say is
 * in view. 0 when nothing is said yet.
 */
function saidTarget(el: HTMLElement): number {
  const said = el.querySelectorAll("[data-said]");
  const last = said[said.length - 1] as HTMLElement | undefined;
  if (!last?.getBoundingClientRect) return 0;
  const bottom = last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
  return Math.max(0, bottom - Math.min(24, el.clientHeight * 0.2));
}

/**
 * Where to scroll so the `n`th word of the text in the box sits READ_LINE
 * down it: you have said that many words, so what is past them comes into
 * view, whatever your words were. The keywords line isn't counted (it isn't
 * read out). 0 when nothing is said, or the page can't measure text.
 */
function spokenTarget(el: HTMLElement, n: number): number {
  if (n <= 0 || typeof document === "undefined" || !document.createTreeWalker || !document.createRange) return 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let count = 0;
  let lastNode: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest("[aria-label='Keywords'], button")) continue;
    const text = node.data;
    const re = /[\p{L}\p{N}][^\s]*/gu;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      count++;
      if (count >= n) return wordTop(el, node, m.index, m[0].length);
    }
    if (text.trim()) lastNode = node;
  }
  // Past the last word: the whole text is said.
  return lastNode ? Number.MAX_SAFE_INTEGER : 0;
}

function wordTop(el: HTMLElement, node: Text, at: number, len: number): number {
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + len);
  if (typeof range.getBoundingClientRect !== "function") return 0;
  const top = range.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  return Math.max(0, top - el.clientHeight * READ_LINE);
}

/**
 * Scrolls an answer like a teleprompter that waits for you:
 * - While you speak, it moves on only past what you have said: the parts
 *   that turned yellow, or as many words of the box's text as you have
 *   said (in your own words too), never ahead of you.
 * - Otherwise it moves on its own at `speed` px/s once the text has been on
 *   screen READING_START_DELAY_MS and the other party has been quiet that
 *   long, and holds still again if they speak.
 * Hovering holds the pace still (not the following); scrolling yourself takes over for a moment. A new
 * answer (`key` changes, or the text gets shorter) starts again from the top.
 */
export function useReadingScroll(
  ref: RefObject<HTMLElement | null>,
  content: string,
  key: string | null,
  speed: number,
  signals: ReadingScrollSignals = LIVE_SIGNALS,
): ReadingScrollHandlers {
  const state = useRef({
    pos: 0, startAt: Infinity, holdUntil: 0, hovered: false, lastLen: 0, key: null as string | null,
    // The spoken target, measured again only when your words or the text change.
    spoken: { n: -1, height: -1, target: 0 },
  });
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  // A new answer: back to the top. The wait starts when its text shows.
  useEffect(() => {
    const s = state.current;
    if (key !== s.key || content.length < s.lastLen) {
      s.key = key;
      s.pos = 0;
      s.startAt = Infinity;
      s.spoken = { n: -1, height: -1, target: 0 };
      if (ref.current) ref.current.scrollTop = 0;
    }
    if (content && s.startAt === Infinity) s.startAt = performance.now() + READING_START_DELAY_MS;
    s.lastLen = content.length;
  }, [content, key, ref]);

  useEffect(() => {
    const s = state.current;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      const el = ref.current;
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        const { otherQuiet, youQuiet: youSilent } = signalsRef.current;
        if (!otherQuiet() && s.startAt !== Infinity) {
          // They are still talking: the wait runs from their last word.
          s.startAt = Math.max(s.startAt, now + READING_START_DELAY_MS - OTHER_PARTY_QUIET_MS);
        }
        const n = Math.floor((signalsRef.current.wordsSaid?.() ?? 0) * SPOKEN_SHARE);
        if (n !== s.spoken.n || el.scrollHeight !== s.spoken.height) {
          s.spoken = { n, height: el.scrollHeight, target: spokenTarget(el, n) };
        }
        const follow = Math.min(max, Math.max(saidTarget(el), s.spoken.target));
        if (now < s.holdUntil) {
          s.pos = el.scrollTop;
        } else if (follow > s.pos + 1) {
          // You said it: move on past it.
          s.pos = Math.min(follow, s.pos + Math.max(FOLLOW_MIN_SPEED, speedRef.current * 4) * dt);
          el.scrollTop = s.pos;
        } else if (s.hovered) {
          // The mouse on the box holds the pace still, not the following.
          s.pos = el.scrollTop;
        } else if (now >= s.startAt && youSilent() && s.pos < max) {
          s.pos = Math.min(max, s.pos + speedRef.current * dt);
          el.scrollTop = s.pos;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref]);

  return useMemo(() => {
    const s = state.current;
    const takeOver = () => { s.holdUntil = performance.now() + MANUAL_HOLD_MS; };
    return {
      onWheel: takeOver,
      onTouchMove: takeOver,
      onMouseEnter: () => { s.hovered = true; },
      onMouseLeave: () => { s.hovered = false; },
    };
  }, []);
}
