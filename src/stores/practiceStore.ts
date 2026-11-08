// Practice mode: NexQ plays the interviewer during a meeting. It asks a
// question aloud, listens to your answer, then scores it out of 10 with
// feedback and a better answer. Questions come from your prepared answers.

import { create } from "zustand";
import type { StarStory } from "./storyStore";

export interface PracticeQuestion {
  question: string;
  /** The prepared story it comes from: the scorer's reference. */
  reference?: string;
}

export interface PracticeResult {
  score: number;
  feedback: string;
  improve: string[];
  better: string;
}

export type PracticePhase = "asking" | "listening" | "scoring" | "feedback" | "done";

/** Used when you have no prepared answers yet. */
export const GENERIC_QUESTIONS: PracticeQuestion[] = [
  { question: "Présente-toi en deux minutes : ton parcours et ce qui t'amène ici." },
  { question: "Raconte-moi un projet dont tu es particulièrement fier, et ton rôle exact." },
  { question: "Parle-moi d'un échec professionnel et de ce que tu en as appris." },
  { question: "Comment tu gères un désaccord technique avec un collègue ou un client ?" },
  { question: "Décris une décision d'architecture difficile que tu as dû prendre." },
  { question: "Pourquoi ce poste, et pourquoi maintenant ?" },
];

/** One question per prepared story, in a shuffled order (or the generic ones). */
export function practiceQuestions(stories: StarStory[], random: () => number = Math.random): PracticeQuestion[] {
  const fromStories = stories
    .filter((s) => s.questions.length > 0)
    .map((s) => ({ question: s.questions[Math.floor(random() * s.questions.length)], reference: s.answer }));
  const list = fromStories.length > 0 ? fromStories : GENERIC_QUESTIONS.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** The scorer's reply: a JSON object, possibly fenced. */
export function parsePracticeResult(text: string): PracticeResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI's reply holds no score");
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const score = Math.max(0, Math.min(10, Number(raw.score)));
  if (!Number.isFinite(score)) throw new Error("The AI's reply holds no score");
  return {
    score: Math.round(score * 10) / 10,
    feedback: String(raw.feedback ?? "").trim(),
    improve: Array.isArray(raw.improve) ? raw.improve.filter((x): x is string => typeof x === "string") : [],
    better: String(raw.better ?? "").trim(),
  };
}

interface PracticeState {
  active: boolean;
  questions: PracticeQuestion[];
  index: number;
  phase: PracticePhase;
  result: PracticeResult | null;
  scores: number[];
  error: string | null;
  start: (questions: PracticeQuestion[]) => void;
  setPhase: (phase: PracticePhase) => void;
  setResult: (result: PracticeResult) => void;
  setError: (error: string | null) => void;
  next: () => void;
  stop: () => void;
}

export const usePracticeStore = create<PracticeState>((set, get) => ({
  active: false,
  questions: [],
  index: 0,
  phase: "asking",
  result: null,
  scores: [],
  error: null,
  start: (questions) => set({ active: true, questions, index: 0, phase: "asking", result: null, scores: [], error: null }),
  setPhase: (phase) => set({ phase }),
  setResult: (result) => set({ result, phase: "feedback", scores: [...get().scores, result.score], error: null }),
  setError: (error) => set({ error }),
  next: () => {
    const { index, questions } = get();
    if (index + 1 >= questions.length) set({ phase: "done", result: null });
    else set({ index: index + 1, phase: "asking", result: null, error: null });
  },
  stop: () => set({ active: false, phase: "asking", result: null, error: null }),
}));
