import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useLiveSpeech", () => ({ speakOnce: vi.fn(async () => {}), stopSpeaking: vi.fn() }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { ANSWER_DONE_QUIET_MS, PracticePanel, stopPractice } from "./PracticePanel";
import { parsePracticeResult, practiceQuestions, usePracticeStore } from "../stores/practiceStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { useQuestionStore } from "../stores/questionStore";
import type { StarStory } from "../stores/storyStore";

const line = (id: string, speaker: string, text: string) => ({ id, speaker, text, timestamp_ms: 0, is_final: true, confidence: 1 }) as never;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  stopPractice();
  useTranscriptStore.setState({ segments: [] });
});

describe("practice", () => {
  it("asks one question per prepared story, else generic ones", () => {
    const stories = [
      { id: "a", title: "A", questions: ["Q1", "Q2"], keywords: [], answer: "Ref A" },
      { id: "b", title: "B", questions: [], keywords: [], answer: "Ref B" },
    ] as StarStory[];
    expect(practiceQuestions(stories, () => 0)).toEqual([{ question: "Q1", reference: "Ref A" }]);
    expect(practiceQuestions([]).length).toBeGreaterThan(3);
  });

  it("reads the score, kept between 0 and 10", () => {
    expect(parsePracticeResult('```json\n{"score": 8.5, "feedback": "Bien", "improve": ["Chiffrer"], "better": "J\'ai…"}\n```'))
      .toEqual({ score: 8.5, feedback: "Bien", improve: ["Chiffrer"], better: "J'ai…" });
    expect(parsePracticeResult('{"score": 14}').score).toBe(10);
    expect(() => parsePracticeResult("Pas de note")).toThrow();
  });

  it("asks aloud, listens to your answer, scores it once you pause", async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue('{"score": 7, "feedback": "Clair mais sans chiffres.", "improve": ["Donner un résultat chiffré"], "better": "J\'ai…"}');
    useQuestionStore.getState().setPaused(true);
    usePracticeStore.getState().start([{ question: "Parle-moi d'un échec", reference: "Ref" }]);
    render(<PracticePanel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(usePracticeStore.getState().phase).toBe("listening");

    act(() => { useTranscriptStore.setState({ segments: [line("u1", "User", "Alors un projet RAG chez un client qui n'a pas tenu en production")] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(ANSWER_DONE_QUIET_MS + 1000); });
    expect(invoke).toHaveBeenCalledWith("score_practice_answer", expect.objectContaining({
      question: "Parle-moi d'un échec", answer: "Alors un projet RAG chez un client qui n'a pas tenu en production", reference: "Ref",
    }));
    expect(usePracticeStore.getState().phase).toBe("feedback");
    expect(screen.getByText("7/10")).toBeTruthy();

    stopPractice();
    expect(useQuestionStore.getState().paused).toBe(false);
  });
});
