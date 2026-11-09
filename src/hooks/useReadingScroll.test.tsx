import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { READING_START_DELAY_MS, useReadingScroll } from "./useReadingScroll";

let now = 0;
let frames: FrameRequestCallback[] = [];

/** Moves time on by `ms`, one 50 ms frame at a time. */
function advance(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    now += 50;
    const run = frames;
    frames = [];
    run.forEach((f) => f(now));
  }
}

beforeEach(() => {
  now = 0;
  frames = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A 100 px box over 1000 px of answer; `saidBottom` is where the yellow part ends. */
function scroller(saidBottom: () => number | null = () => null) {
  const el = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 100,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => {
      const bottom = saidBottom();
      return bottom === null ? [] : [{ getBoundingClientRect: () => ({ bottom: bottom - el.scrollTop }) }];
    },
  };
  return { el, ref: { current: el as unknown as HTMLElement } };
}

it("waits 8 s after the text shows before it moves on its own", () => {
  const { el, ref } = scroller();
  renderHook(() => useReadingScroll(ref, "une réponse", "a", 20, { otherQuiet: () => true, youQuiet: () => true }));
  advance(READING_START_DELAY_MS - 200);
  expect(el.scrollTop).toBe(0);
  advance(1000);
  expect(el.scrollTop).toBeGreaterThan(0);
});

it("waits 8 s after the other party's last word, and holds still when they speak again", () => {
  const { el, ref } = scroller();
  let otherQuiet = false;
  renderHook(() => useReadingScroll(ref, "une longue réponse", "a", 20, { otherQuiet: () => otherQuiet, youQuiet: () => true }));

  advance(READING_START_DELAY_MS + 3000);
  expect(el.scrollTop).toBe(0); // they are still talking

  otherQuiet = true;
  advance(READING_START_DELAY_MS - 2500);
  expect(el.scrollTop).toBe(0);
  advance(2000);
  expect(el.scrollTop).toBeGreaterThan(0);

  const at = el.scrollTop;
  otherQuiet = false;
  advance(1000);
  expect(el.scrollTop).toBe(at);
});

it("while you speak, moves on only past what you have said", () => {
  let saidBottom: number | null = null;
  const { el, ref } = scroller(() => saidBottom);
  renderHook(() => useReadingScroll(ref, "une réponse", "a", 20, { otherQuiet: () => true, youQuiet: () => false }));

  advance(READING_START_DELAY_MS + 2000);
  expect(el.scrollTop).toBe(0); // nothing said yet: it doesn't run ahead of you

  saidBottom = 200; // you said the first lines (they turned yellow)
  advance(3000);
  expect(el.scrollTop).toBeGreaterThan(150);
  expect(el.scrollTop).toBeLessThanOrEqual(200);
  const at = el.scrollTop;
  advance(3000);
  expect(el.scrollTop).toBe(at); // and waits there for what you say next
});

it("while you speak in your own words, moves on as far as you have said, from what is in the box", () => {
  // 40 words, one per 20 px line, in a 100 px box.
  const box = document.createElement("div");
  box.textContent = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(" ");
  document.body.appendChild(box);
  Object.defineProperty(box, "scrollHeight", { value: 800 });
  Object.defineProperty(box, "clientHeight", { value: 100 });
  box.getBoundingClientRect = () => ({ top: -box.scrollTop }) as DOMRect;
  const lineOf = (offset: number) => box.textContent!.slice(0, offset).split(" ").length - 1;
  // jsdom lays nothing out: each word's line is given here.
  const proto = Range.prototype as { getBoundingClientRect?: () => DOMRect };
  const had = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: Range) {
    return { top: lineOf(this.startOffset) * 20 - box.scrollTop } as DOMRect;
  };
  let said = 0;
  renderHook(() =>
    useReadingScroll({ current: box }, box.textContent!, "a", 20, { otherQuiet: () => true, youQuiet: () => false, wordsSaid: () => said }),
  );

  advance(2000);
  expect(box.scrollTop).toBe(0);

  said = 24; // 20 counted: word 20 is at 400 px, shown 30 px down the box
  advance(5000);
  expect(box.scrollTop).toBeGreaterThan(300);
  expect(box.scrollTop).toBeLessThanOrEqual(400 - 30);
  box.remove();
  proto.getBoundingClientRect = had;
});
