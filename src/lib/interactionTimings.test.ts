import { describe, expect, it } from "vitest";
import { interactionTimings } from "./interactionTimings";

describe("saved answer timings", () => {
  it("keeps the wait from asking and from the AI's start until the first words", () => {
    expect(interactionTimings({ requestedAt: 1000, startedAt: 1400, firstTokenAt: 2100 })).toEqual({ first_token_ms: 700, wait_ms: 1100 });
  });
  it("leaves out what wasn't measured", () => {
    expect(interactionTimings({ requestedAt: null, startedAt: 1400, firstTokenAt: 2100 })).toEqual({ first_token_ms: 700 });
    expect(interactionTimings({ requestedAt: 1000, startedAt: 1400, firstTokenAt: null })).toEqual({});
    // A request time from another, later answer.
    expect(interactionTimings({ requestedAt: 3000, startedAt: 1400, firstTokenAt: 2100 })).toEqual({ first_token_ms: 700 });
  });
});
