import { useEffect, useRef, useState } from "react";
import { GraduationCap, Loader2, Mic, SkipForward, Square } from "lucide-react";
import { parsePracticeResult, practiceQuestions, usePracticeStore } from "../stores/practiceStore";
import { useStoryStore } from "../stores/storyStore";
import { useQuestionStore } from "../stores/questionStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { speakOnce, stopSpeaking } from "../hooks/useLiveSpeech";

/** You have finished answering once quiet this long, after at least a few words. */
export const ANSWER_DONE_QUIET_MS = 5000;
const MIN_ANSWER_WORDS = 8;

/** Starts Practice mode: Auto-Answer pauses while NexQ plays the interviewer. */
export async function startPractice(): Promise<void> {
  await useStoryStore.getState().load();
  useQuestionStore.getState().setPaused(true);
  usePracticeStore.getState().start(practiceQuestions(useStoryStore.getState().stories));
}

export function stopPractice(): void {
  stopSpeaking();
  usePracticeStore.getState().stop();
  useQuestionStore.getState().setPaused(false);
}

/** Your words since `baseline` (how much of each of your lines was said then). */
function heardSince(baseline: Map<string, number>): string {
  return useTranscriptStore
    .getState()
    .segments.filter((s) => s.speaker === "User")
    .map((s) => s.text.slice(baseline.get(s.id) ?? 0))
    .join(" ")
    .trim();
}

function snapshot(): Map<string, number> {
  return new Map(useTranscriptStore.getState().segments.filter((s) => s.speaker === "User").map((s) => [s.id, s.text.length]));
}

/** Practice mode in the overlay: the question, your answer as heard, then the score. */
export function PracticePanel() {
  const { active, questions, index, phase, result, scores, error } = usePracticeStore();
  const current = questions[index];
  const [heard, setHeard] = useState("");
  const baseline = useRef(new Map<string, number>());

  // Ask the question aloud, then listen.
  useEffect(() => {
    if (!active || phase !== "asking" || !current) return;
    let cancelled = false;
    setHeard("");
    void speakOnce(current.question).then(() => {
      if (cancelled) return;
      baseline.current = snapshot();
      usePracticeStore.getState().setPhase("listening");
    });
    return () => { cancelled = true; };
  }, [active, phase, index, current]);

  // Listen until you have been quiet for a moment, then score.
  useEffect(() => {
    if (!active || phase !== "listening") return;
    let lastText = "";
    let lastChange = Date.now();
    const timer = setInterval(() => {
      const text = heardSince(baseline.current);
      if (text !== lastText) {
        lastText = text;
        lastChange = Date.now();
        setHeard(text);
      }
      const words = text.split(/\s+/u).filter(Boolean).length;
      if (words >= MIN_ANSWER_WORDS && Date.now() - lastChange >= ANSWER_DONE_QUIET_MS) {
        clearInterval(timer);
        void score(text);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [active, phase, index]);

  const score = async (answer: string) => {
    const store = usePracticeStore.getState();
    const q = store.questions[store.index];
    if (!q) return;
    store.setPhase("scoring");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke<string>("score_practice_answer", { question: q.question, answer, reference: q.reference ?? null, language: "French" });
      const parsed = parsePracticeResult(text);
      usePracticeStore.getState().setResult(parsed);
      void speakOnce(`${String(parsed.score).replace(".", ",")} sur dix. ${parsed.feedback}`);
    } catch (e) {
      usePracticeStore.getState().setError(e instanceof Error ? e.message : String(e));
      usePracticeStore.getState().setPhase("listening");
    }
  };

  if (!active) return null;
  const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

  return (
    <div className="shrink-0 space-y-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3" role="region" aria-label="Practice">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <GraduationCap className="h-3.5 w-3.5" />
        Practice · {Math.min(index + 1, questions.length)}/{questions.length}
        {average && <span className="text-muted-foreground">· average {average}/10</span>}
        <button type="button" onClick={stopPractice} className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground">
          <Square className="h-3 w-3" /> Stop
        </button>
      </div>

      {phase === "done" ? (
        <p className="text-sm text-foreground">Done: {scores.length} answers, average {average ?? "–"}/10.</p>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">{current?.question}</p>
          {phase === "listening" && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mic className="h-3 w-3 animate-pulse text-destructive" /> Answer aloud; NexQ scores it once you pause.
                <button type="button" onClick={() => void score(heardSince(baseline.current))} disabled={!heard} className="ml-auto rounded px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40">
                  I'm done
                </button>
              </p>
              {heard && <p className="line-clamp-3 text-xs italic text-foreground/70">{heard}</p>}
            </div>
          )}
          {phase === "asking" && <p className="text-xs text-muted-foreground">Listen to the question…</p>}
          {phase === "scoring" && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Scoring your answer…</p>}
          {error && <p className="text-xs text-destructive/80">{error}</p>}
          {phase === "feedback" && result && (
            <div className="space-y-1.5">
              <p className="text-sm"><span className="text-lg font-bold text-primary">{result.score}/10</span> <span className="text-foreground/80">{result.feedback}</span></p>
              {result.improve.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-foreground/80">{result.improve.map((p, i) => <li key={i}>{p}</li>)}</ul>
              )}
              {result.better && (
                <p className="rounded-md bg-emerald-400/5 p-2 text-xs text-foreground/90"><span className="font-semibold text-emerald-300/90">Better answer: </span>{result.better}</p>
              )}
              <button type="button" onClick={() => { stopSpeaking(); usePracticeStore.getState().next(); }} className="flex items-center gap-1 rounded-md bg-primary/15 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/25">
                <SkipForward className="h-3.5 w-3.5" /> Next question
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
