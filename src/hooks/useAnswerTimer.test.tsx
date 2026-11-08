import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerTimeColor, formatAnswerTime, useAnswerTimer } from "./useAnswerTimer";
import { useTranscriptStore } from "../stores/transcriptStore";
import type { TranscriptSegment } from "../lib/types";

const line = (id: string, speaker: string, text: string) =>
  ({ id, speaker, text, timestamp_ms: 0, is_final: true, confidence: 1 }) as TranscriptSegment;

afterEach(() => {
  vi.useRealTimers();
  useTranscriptStore.setState({ segments: [] });
});

describe("answer timer", () => {
  it("counts from your first words after the other party, while you keep talking", () => {
    vi.useFakeTimers();
    useTranscriptStore.setState({ segments: [line("t1", "Them", "Parle-moi de toi")] });
    const { result } = renderHook(() => useAnswerTimer());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBeNull();

    act(() => { useTranscriptStore.setState({ segments: [line("t1", "Them", "Parle-moi de toi"), line("y1", "User", "Alors")] }); });
    for (let i = 1; i <= 20; i++) {
      act(() => {
        useTranscriptStore.setState({ segments: [line("t1", "Them", "…"), line("y1", "User", "Alors" + " mot".repeat(i))] });
        vi.advanceTimersByTime(4500);
      });
    }
    expect(result.current).toBeGreaterThanOrEqual(89_000);

    // Quiet for a while: the turn is over.
    act(() => { vi.advanceTimersByTime(7000); });
    expect(result.current).toBeNull();
  });

  it("formats and colours by length", () => {
    expect(formatAnswerTime(65_400)).toBe("1:05");
    expect(answerTimeColor(30_000)).toBe("text-white/60");
    expect(answerTimeColor(95_000)).toBe("text-amber-300");
    expect(answerTimeColor(125_000)).toBe("text-red-400");
  });
});
