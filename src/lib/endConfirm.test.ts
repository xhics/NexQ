import { describe, expect, it } from "vitest";
import { END_CONFIRM_MS, confirmsEnd } from "./endConfirm";

describe("confirmsEnd", () => {
  it("a first press never ends the meeting", () => {
    expect(confirmsEnd(null, 1000)).toBe(false);
  });

  it("a second press within the delay ends it", () => {
    expect(confirmsEnd(1000, 1000 + END_CONFIRM_MS)).toBe(true);
    expect(confirmsEnd(1000, 1500)).toBe(true);
  });

  it("a second press after the delay only arms again", () => {
    expect(confirmsEnd(1000, 1001 + END_CONFIRM_MS)).toBe(false);
  });

  it("a clock that went back does not count", () => {
    expect(confirmsEnd(1000, 900)).toBe(false);
  });
});
