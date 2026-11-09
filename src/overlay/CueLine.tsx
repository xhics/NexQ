import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { covered, saidInOrder } from "../hooks/useSaidSinceAnswer";
import { splitNotes } from "../lib/answerNotes";

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

/**
 * What you have said turns yellow (not struck out), so you see at a glance
 * how far you are; `data-said` lets the reading scroll follow you.
 */
export const SAID_CLASS = "text-yellow-300";
const saidProps = (isSaid: boolean) => (isSaid ? { className: SAID_CLASS, "data-said": "1" } : {});

export function CueLine({ words, fontSize, said }: { words: string[]; fontSize: number; said?: Set<string> }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-x-2 gap-y-1" aria-label="Keywords" style={{ fontSize: `${fontSize}px` }}>
      {words.map((w, i) => (
        <span
          key={`${i}-${w}`}
          className={`rounded px-1.5 py-0.5 font-semibold ${said && covered(w, said) ? "bg-yellow-400/35 text-yellow-200" : "bg-amber-400/15 text-amber-200"}`}
          data-said={said && covered(w, said) ? "1" : undefined}
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

/** Sentences of a paragraph, each yellow once said. */
function Sentences({ children, isSaid }: { children: ReactNode; isSaid: (piece: string) => boolean }) {
  if (typeof children !== "string") return <>{children}</>;
  const parts = children.match(/[^.!?…]+[.!?…]*\s*/gu) ?? [children];
  return <>{parts.map((p, i) => <span key={i} {...saidProps(isSaid(p))}>{p}</span>)}</>;
}

/**
 * An answer's markdown, its cue card (if any) shown apart above it and its
 * notes (if any) apart below it.
 */
export function AnswerMarkdown({ content, cueSize, said }: { content: string; cueSize: number; said?: Set<string> }) {
  const { answer, notes } = splitNotes(content);
  const { cue, rest } = splitCue(answer);
  const components = useMemo<Components | undefined>(() => {
    if (!said || said.size === 0) return undefined;
    // Said in order: what comes before the last part you said is said too.
    const isSaid = saidInOrder(rest, said);
    return {
      li: ({ node, children, ...props }) => (
        <li {...props} {...saidProps(isSaid(hastText(node as HastNode)))}>{children}</li>
      ),
      // A paragraph of plain text goes yellow sentence by sentence; one with
      // bold or links in it, as a whole.
      p: ({ node, children, ...props }) =>
        typeof children === "string"
          ? <p {...props}><Sentences isSaid={isSaid}>{children}</Sentences></p>
          : <p {...props} {...saidProps(isSaid(hastText(node as HastNode)))}>{children}</p>,
    };
  }, [said, rest]);
  return (
    <>
      {cue && <CueLine words={cue} fontSize={cueSize} said={said} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{rest}</ReactMarkdown>
      {notes.length > 0 && (
        <div className="not-prose mt-2 rounded border border-sky-400/25 bg-sky-400/5 px-2 py-1" role="note" aria-label="Notes">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-sky-400/90">Notes</div>
          <ul className="text-[0.9em] text-sky-200/90">
            {notes.map((n, i) => <li key={i}>· {n}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
