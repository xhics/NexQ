import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { generateStories, useStoryStore, type StarStory } from "../stores/storyStore";
import { showToast } from "../stores/toastStore";

const LANGUAGES = [
  { label: "Français", value: "French" },
  { label: "English", value: "English" },
];

const field =
  "w-full rounded-md border border-border/30 bg-secondary/30 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none";

/** Settings > Prepared answers: STAR stories from the CV, reviewed before the interview. */
export function StoriesSettings() {
  const stories = useStoryStore((s) => s.stories);
  const setStories = useStoryStore((s) => s.setStories);
  const [job, setJob] = useState("");
  const [language, setLanguage] = useState("French");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void useStoryStore.getState().load();
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const written = await generateStories(job, language);
      setStories([...useStoryStore.getState().stories, ...written]);
      showToast(`${written.length} stories written: review them before the interview`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addEmpty = () => {
    const story: StarStory = { id: crypto.randomUUID(), title: "New story", questions: [], keywords: [], answer: "" };
    setStories([...stories, story]);
    setOpen(story.id);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4 text-primary" /> Prepared answers
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          STAR stories drawn from your CV. When a question matches one during a meeting, its answer shows at once,
          above the AI's, before the AI has written anything. Review and correct them: they say what you validated.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border/20 bg-card/20 p-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="story-job">
          The job (optional): paste the offer to aim the stories at it
        </label>
        <textarea
          id="story-job"
          className={`${field} h-20 resize-y`}
          value={job}
          onChange={(e) => setJob(e.target.value)}
          placeholder="Architecte GenAI / hyperautomatisation chez…"
        />
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border/30" role="radiogroup" aria-label="Language of the stories">
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={language === l.value}
                onClick={() => setLanguage(l.value)}
                className={`px-2 py-1 text-[11px] font-medium ${language === l.value ? "bg-primary/15 text-primary" : "text-muted-foreground/60 hover:text-foreground"}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? "Writing…" : "Write stories from my CV"}
          </button>
        </div>
        {error && <p className="text-xs text-destructive/80">{error}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {stories.length} {stories.length === 1 ? "story" : "stories"}
          </span>
          <button type="button" onClick={addEmpty} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Add one
          </button>
        </div>
        {stories.map((story) => (
          <StoryItem key={story.id} story={story} open={open === story.id} onToggle={() => setOpen(open === story.id ? null : story.id)} />
        ))}
      </div>
    </div>
  );
}

function StoryItem({ story, open, onToggle }: { story: StarStory; open: boolean; onToggle: () => void }) {
  const update = useStoryStore((s) => s.updateStory);
  const remove = useStoryStore((s) => s.removeStory);
  const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div className="rounded-lg border border-border/20 bg-card/10">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="flex-1 truncate text-xs font-medium text-foreground">{story.title}</span>
        <span className="text-[10px] text-muted-foreground/60">{story.questions.length} questions</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/10 px-3 pb-3 pt-2">
          <input className={field} value={story.title} onChange={(e) => update(story.id, { title: e.target.value })} aria-label="Title" />
          <label className="block text-[11px] text-muted-foreground">Keywords (separated by ·)</label>
          <input
            className={field}
            defaultValue={story.keywords.join(" · ")}
            onBlur={(e) => update(story.id, { keywords: e.target.value.split(/\s*[·,]\s*/u).filter(Boolean) })}
            aria-label="Keywords"
          />
          <label className="block text-[11px] text-muted-foreground">Questions it answers (one per line)</label>
          <textarea
            className={`${field} h-24 resize-y`}
            defaultValue={story.questions.join("\n")}
            onBlur={(e) => update(story.id, { questions: lines(e.target.value) })}
            aria-label="Questions"
          />
          <label className="block text-[11px] text-muted-foreground">The answer, as you would tell it</label>
          <textarea
            className={`${field} h-40 resize-y`}
            value={story.answer}
            onChange={(e) => update(story.id, { answer: e.target.value })}
            aria-label="Answer"
          />
          <button type="button" onClick={() => remove(story.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive/70 hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
