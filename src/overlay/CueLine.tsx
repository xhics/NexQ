import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The cue card of an answer (Settings > AI Actions > Cue card): a first line
 * starting with "⚡" that lists the keywords to mention, shown apart and large.
 */
export function splitCue(content: string): { cue: string[] | null; rest: string } {
  const match = content.match(/^\s*⚡\s*([^\n]*)(?:\n|$)/u);
  if (!match) return { cue: null, rest: content };
  const words = match[1]
    .replace(/[*_`]/g, "")
    .split(/\s*[·•|]\s*/u)
    .map((w) => w.trim())
    .filter(Boolean);
  return { cue: words.length ? words : null, rest: content.slice(match[0].length).replace(/^\s+/u, "") };
}

export function CueLine({ words, fontSize }: { words: string[]; fontSize: number }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-x-2 gap-y-1" aria-label="Keywords" style={{ fontSize: `${fontSize}px` }}>
      {words.map((w, i) => (
        <span
          key={`${i}-${w}`}
          className="rounded bg-amber-400/15 px-1.5 py-0.5 font-semibold text-amber-200"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
        >
          {w}
        </span>
      ))}
    </div>
  );
}

/** An answer's markdown, its cue card (if any) shown apart above it. */
export function AnswerMarkdown({ content, cueSize }: { content: string; cueSize: number }) {
  const { cue, rest } = splitCue(content);
  return (
    <>
      {cue && <CueLine words={cue} fontSize={cueSize} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{rest}</ReactMarkdown>
    </>
  );
}
