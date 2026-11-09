// What the voice reads of an answer: the essentials, not every word. The
// answer is written to be read on screen (keywords, titles, labels, lists);
// in your headset you only need the opening sentence and the gist of each
// point, briefly, while you speak.
//
// It takes the answer as it is written, piece by piece (each finished
// sentence or line), and keeps:
// - the first sentence of each list item, two of each paragraph;
// - each sentence cut to about MAX_SENTENCE_WORDS words (at a comma if it can);
// - about MAX_ANSWER_WORDS words in all, then nothing more.
// It leaves out the cue card's "⚡" keywords, titles, labels such as
// "Situation :" or "Réponse :", tables and code.

/** Words read for one answer, at most (a sentence may finish over it). */
export const MAX_ANSWER_WORDS = 55;
/** A sentence longer than this is cut, at a comma when there is one. */
export const MAX_SENTENCE_WORDS = 18;
/** Sentences read per paragraph; a list item gives one. */
const PARAGRAPH_SENTENCES = 2;
/** A piece ending in ":" with this many words or fewer is a label. */
const LABEL_WORDS = 4;

const LETTERS = /[\p{L}\p{N}]/u;

/** Markdown to plain words (no markers, links or code). */
function plain(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/[*_~#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** At most `max` words, cut after the last comma in them when there is one. */
export function shortenSentence(sentence: string, max = MAX_SENTENCE_WORDS): string {
  const all = words(sentence);
  if (all.length <= max) return sentence;
  const head = all.slice(0, max);
  for (let i = head.length - 1; i >= Math.floor(max / 2); i--) {
    if (/[,;]$/.test(head[i])) return head.slice(0, i + 1).join(" ").replace(/[,;]$/, ".");
  }
  return `${head.join(" ").replace(/[,;:]$/, "")}…`;
}

export class EssentialReader {
  private spokenWords = 0;
  /** Sentences already read from the current block (paragraph or item). */
  private blockSentences = 0;
  private blockIsItem = false;
  private atLineStart = true;
  private skipLine = false;
  private inCode = false;

  /** What to say of `chunk` (finished text that follows the last chunk); "" for nothing. */
  take(chunk: string): string {
    const out: string[] = [];
    for (const part of chunk.split(/(\n)/)) {
      if (part === "\n") {
        this.atLineStart = true;
        this.skipLine = false;
        continue;
      }
      let text = part;
      if (this.atLineStart && text.trim()) {
        this.atLineStart = false;
        const line = text.trimStart();
        if (line.startsWith("```")) {
          this.inCode = !this.inCode;
          this.skipLine = true;
        } else if (
          this.inCode
          || line.startsWith("⚡")
          || /^#{1,6}\s/.test(line)
          || line.startsWith("|")
          || /^[-*_]{3,}\s*$/.test(line)
        ) {
          this.skipLine = true;
        } else {
          // A new line is a new block: a list item, or a paragraph.
          const item = /^(?:[-*+•]|\d+[.)])\s+/.exec(line);
          this.blockIsItem = !!item;
          this.blockSentences = 0;
          text = item ? line.slice(item[0].length) : line;
          // A line that is only a bold title ("**Résultat**").
          if (/^\*\*[^*]+\*\*\s*$/.test(text.trim())) this.skipLine = true;
        }
      }
      if (this.skipLine || this.inCode) continue;
      for (const piece of text.split(/(?<=[.!?…:;])\s+/)) {
        const said = this.sentence(piece);
        if (said) out.push(said);
      }
    }
    return out.join(" ");
  }

  private sentence(piece: string): string {
    const text = plain(piece);
    if (!LETTERS.test(text)) return "";
    // "Situation :", "Réponse :", "Points clés :"
    if (/:$/.test(text) && words(text).length <= LABEL_WORDS) return "";
    const perBlock = this.blockIsItem ? 1 : PARAGRAPH_SENTENCES;
    if (this.blockSentences >= perBlock || this.spokenWords >= MAX_ANSWER_WORDS) return "";
    const short = shortenSentence(text.replace(/:$/, "."));
    this.blockSentences += 1;
    this.spokenWords += words(short).length;
    return short;
  }
}

/** The essentials of a whole text at once (a prepared story). */
export function essentialSpeech(text: string): string {
  return new EssentialReader().take(text);
}
