import { useEffect, useMemo, useState } from "react";
import { BookOpen, X } from "lucide-react";
import { useQuestionStore } from "../stores/questionStore";
import { matchStory, useStoryStore, type StarStory } from "../stores/storyStore";
import { matchStoryByMeaning } from "../stores/storyMeaning";
import { CueLine, SAID_CLASS } from "./CueLine";
import { covered } from "../hooks/useSaidSinceAnswer";

/**
 * The prepared story that answers the newest question, if one does: shown
 * at once (by its words), or a moment later by meaning when Ollama runs.
 * Hidden for that question once closed.
 */
export function usePreparedStory(): { story: StarStory | null; hide: () => void } {
  const stories = useStoryStore((s) => s.stories);
  const question = useQuestionStore((s) => s.questions[0]?.text ?? "");
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [byMeaning, setByMeaning] = useState<{ question: string; story: StarStory | null } | null>(null);

  useEffect(() => {
    void useStoryStore.getState().load();
  }, []);

  const byWords = useMemo(() => (question && stories.length ? matchStory(question, stories) : null), [question, stories]);

  useEffect(() => {
    if (!question || byWords || stories.length === 0) return;
    let current = true;
    void matchStoryByMeaning(question, stories).then((story) => {
      if (current) setByMeaning({ question, story });
    });
    return () => { current = false; };
  }, [question, byWords, stories]);

  const story = byWords ?? (byMeaning?.question === question ? byMeaning.story : null);
  return {
    story: story && hiddenFor !== question ? story : null,
    hide: () => setHiddenFor(question),
  };
}

export function PreparedStory({ story, fontSize, onHide, said }: { story: StarStory; fontSize: number; onHide: () => void; said?: Set<string> }) {
  const sentences = story.answer.match(/[^.!?…]+[.!?…]*\s*/gu) ?? [story.answer];
  return (
    <div
      className="mb-2 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2 py-1.5"
      role="note"
      aria-label={`Prepared story: ${story.title}`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/90">
        <BookOpen className="h-3 w-3" aria-hidden="true" />
        <span className="truncate">Prepared · {story.title}</span>
        <button
          type="button"
          onClick={onHide}
          className="ml-auto rounded p-0.5 text-emerald-200/60 hover:bg-white/10 hover:text-white"
          title="Hide for this question"
          aria-label="Hide the prepared story for this question"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {story.keywords.length > 0 && <CueLine words={story.keywords} fontSize={fontSize + 1} said={said} />}
      <p className="whitespace-pre-line" style={{ fontSize: `${fontSize}px`, lineHeight: 1.45 }}>
        {sentences.map((part, i) => (
          <span key={i} {...(said && covered(part, said) ? { className: SAID_CLASS, "data-said": "1" } : {})}>{part}</span>
        ))}
      </p>
    </div>
  );
}
