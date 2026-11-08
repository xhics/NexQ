import { useEffect, useMemo, useRef, type RefObject } from "react";

/** Wait before the text starts moving, so the first lines can be read. */
export const READING_START_DELAY_MS = 2500;
/** After your own scroll, the text stays where you put it this long. */
const MANUAL_HOLD_MS = 5000;

/** Handlers to put on the scrolled element. */
export interface ReadingScrollHandlers {
  onWheel: () => void;
  onTouchMove: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Scrolls an answer like a teleprompter: it starts at the top and moves at
 * `speed` px/s, never faster, however fast the words arrive. Hovering holds
 * it still; scrolling yourself takes over for a moment. A new answer (`key`
 * changes, or the text gets shorter) starts again from the top.
 */
export function useReadingScroll(
  ref: RefObject<HTMLElement | null>,
  content: string,
  key: string | null,
  speed: number,
): ReadingScrollHandlers {
  const state = useRef({ pos: 0, startAt: 0, holdUntil: 0, hovered: false, lastLen: 0, key: null as string | null });
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // A new answer: back to the top.
  useEffect(() => {
    const s = state.current;
    if (key !== s.key || content.length < s.lastLen) {
      s.key = key;
      s.pos = 0;
      s.startAt = performance.now() + READING_START_DELAY_MS;
      if (ref.current) ref.current.scrollTop = 0;
    }
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
        if (now < s.holdUntil || s.hovered) {
          s.pos = el.scrollTop;
        } else if (now >= s.startAt && s.pos < max) {
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
