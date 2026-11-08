import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { covered } from "../hooks/useSaidSinceAnswer";

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

/** What you have said is struck out and dimmed: what is left to say stands out. */
const DONE = "line-through opacity-40";

export function CueLine({ words, fontSize, said }: { words: string[]; fontSize: number; said?: Set<string> }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-x-2 gap-y-1" aria-label="Keywords" style={{ fontSize: `${fontSize}px` }}>
      {words.map((w, i) => (
        <span
          key={`${i}-${w}`}
          className={`rounded bg-amber-400/15 px-1.5 py-0.5 font-semibold text-amber-200 ${said && covered(w, said) ? DONE : ""}`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
        >
          {w}
        </span>
      ))}
    </div>
  );
}

type HastNode = { type: string; value?: string; children?: HastNode[] };
function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

/** Sentences of a paragraph, each struck out once said. */
function Sentences({ children, said }: { children: ReactNode; said: Set<string> }) {
  if (typeof children !== "string") return <>{children}</>;
  const parts = children.match(/[^.!?…]+[.!?…]*\s*/gu) ?? [children];
  return <>{parts.map((p, i) => <span key={i} className={covered(p, said) ? DONE : undefined}>{p}</span>)}</>;
}

/** An answer's markdown, its cue card (if any) shown apart above it. */
export function AnswerMarkdown({ content, cueSize, said }: { content: string; cueSize: number; said?: Set<string> }) {
  const { cue, rest } = splitCue(content);
  const components = useMemo<Components | undefined>(() => {
    if (!said || said.size === 0) return undefined;
    return {
      li: ({ node, children, ...props }) => (
        <li {...props} className={covered(hastText(node as HastNode), said) ? DONE : undefined}>{children}</li>
      ),
      p: ({ node: _node, children, ...props }) => (
        <p {...props}><Sentences said={said}>{children}</Sentences></p>
      ),
    };
  }, [said]);
  return (
    <>
      {cue && <CueLine words={cue} fontSize={cueSize} said={said} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{rest}</ReactMarkdown>
    </>
  );
}
