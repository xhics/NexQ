import { useEffect, useState } from "react";
import { BookmarkPlus, Check, GraduationCap, Loader2 } from "lucide-react";
import type { Meeting } from "../../lib/types";
import { useStoryStore } from "../../stores/storyStore";
import { showToast } from "../../stores/toastStore";

export interface DebriefItem {
  question: string;
  answered: string;
  feedback: string | null;
  improve: string[];
  better: string;
}

/** The debrief items in the model's reply: a JSON array, possibly fenced. */
export function parseDebrief(text: string): DebriefItem[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("The AI's reply holds no debrief");
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("The AI's reply holds no debrief");
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      question: String(r.question ?? "").trim(),
      answered: String(r.answered ?? "").trim(),
      feedback: typeof r.feedback === "string" && r.feedback.trim() ? r.feedback.trim() : null,
      improve: Array.isArray(r.improve) ? r.improve.filter((x): x is string => typeof x === "string") : [],
      better: String(r.better ?? "").trim(),
    }))
    .filter((d) => d.question);
}

/** The transcript as the model reads it: "You:" / "Them:" lines. */
export function transcriptText(meeting: Meeting): string {
  return meeting.transcript
    .filter((s) => s.text.trim())
    .map((s) => `${s.speaker === "User" ? "You" : "Them"}: ${s.text.trim()}`)
    .join("\n");
}

// The debrief is kept in this window's storage, per meeting.
const keyFor = (id: string) => `nexq.debrief.${id}`;
function loadSaved(id: string): DebriefItem[] | null {
  try { return JSON.parse(localStorage.getItem(keyFor(id)) ?? "null"); } catch { return null; }
}
function save(id: string, items: DebriefItem[]): void {
  try { localStorage.setItem(keyFor(id), JSON.stringify(items)); } catch { /* storage unavailable */ }
}

/** Meeting > Debrief: each question, what you answered, the feedback, what to improve and a better answer. */
export function DebriefTab({ meeting }: { meeting: Meeting }) {
  const [items, setItems] = useState<DebriefItem[] | null>(() => loadSaved(meeting.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  useEffect(() => { void useStoryStore.getState().load(); }, []);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const { generateInterviewDebrief } = await import("../../lib/ipc");
      const text = await generateInterviewDebrief(transcriptText(meeting), "French");
      const parsed = parseDebrief(text);
      setItems(parsed);
      setSaved(new Set());
      save(meeting.id, parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // A better answer becomes a prepared answer for next time.
  const keep = (item: DebriefItem, index: number) => {
    const store = useStoryStore.getState();
    store.setStories([
      ...store.stories,
      { id: crypto.randomUUID(), title: item.question.slice(0, 80), questions: [item.question], keywords: [], answer: item.better, original: item.better },
    ]);
    setSaved(new Set(saved).add(index));
    showToast("Saved to Prepared Answers", "success");
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-primary" />
        <p className="flex-1 text-xs text-muted-foreground">
          Each question you were asked, what you answered, the feedback you got, what to improve, and a better answer
          you can keep as a prepared answer.
        </p>
        <button
          type="button"
          onClick={write}
          disabled={busy || meeting.transcript.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Writing…" : items ? "Write again" : "Write the debrief"}
        </button>
      </div>
      {error && <p className="text-xs text-destructive/80">{error}</p>}
      {items?.length === 0 && <p className="text-xs text-muted-foreground">No interview questions found in this meeting.</p>}
      {items?.map((item, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-border/20 bg-card/10 p-3">
          <p className="text-sm font-medium text-foreground">{item.question}</p>
          <p className="text-xs text-muted-foreground"><span className="font-semibold">You answered:</span> {item.answered}</p>
          {item.feedback && <p className="text-xs text-amber-300/90"><span className="font-semibold">Feedback:</span> {item.feedback}</p>}
          {item.improve.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-foreground/80">
              {item.improve.map((p, j) => <li key={j}>{p}</li>)}
            </ul>
          )}
          {item.better && (
            <div className="rounded-md bg-emerald-400/5 p-2 text-xs text-foreground/90">
              <span className="font-semibold text-emerald-300/90">Better answer: </span>{item.better}
            </div>
          )}
          {item.better && (
            <button
              type="button"
              onClick={() => keep(item, i)}
              disabled={saved.has(i)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10 disabled:text-success"
            >
              {saved.has(i) ? <Check className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
              {saved.has(i) ? "Kept as a prepared answer" : "Keep as a prepared answer"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
