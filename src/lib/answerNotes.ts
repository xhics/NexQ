// The notes an answer carries for your eyes only (figures, names, terms to
// mention), written by the AI after the answer under a NOTES_MARK line. They
// show beside the answer, not in it, and aren't read aloud.

/** The line the backend asks the AI to put before its notes (see intelligence_commands.rs). */
export const NOTES_MARK = "---NOTES---";

/**
 * An answer's text without its notes, and the notes (one per item, "- "
 * taken off). A continuation adds its own notes later in the text: all of
 * them are gathered. A marker line still arriving ("---NO") is left out.
 */
export function splitNotes(content: string): { answer: string; notes: string[] } {
  const lines = content.split("\n");
  const answer: string[] = [];
  const notes: string[] = [];
  let inNotes = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === NOTES_MARK) {
      inNotes = true;
      return;
    }
    // The marker being streamed in: not words of the answer.
    if (i === lines.length - 1 && line.length >= 3 && NOTES_MARK.startsWith(line)) return;
    if (inNotes) {
      if (line === "") return;
      const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/u);
      if (item) {
        notes.push(item[1].trim());
        return;
      }
      // Anything else after the notes is answer again (a continuation's words),
      // a paragraph of its own.
      inNotes = false;
      if (answer.length > 0) answer.push("");
    }
    answer.push(raw);
  });
  return { answer: answer.join("\n").replace(/\s+$/u, ""), notes: notes.filter(Boolean).slice(0, MAX_NOTES).map(brief) };
}

/** Notes are glanced at: this many at most, of NOTE_WORDS words at most. */
const MAX_NOTES = 3;
const NOTE_WORDS = 6;
const brief = (note: string) => {
  const words = note.replace(/\*\*/g, "").split(/\s+/u);
  return words.length > NOTE_WORDS ? `${words.slice(0, NOTE_WORDS).join(" ")}…` : words.join(" ");
};

/** An answer's text without its notes. */
export const withoutNotes = (content: string) => splitNotes(content).answer;
