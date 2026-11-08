// @vitest-environment node
// Question detection on your own past meetings: `npm run report:questions`.
// Reads the local NexQ database read-only and prints, for each line from the
// other party, whether a question was found and what Auto-Answer would answer.
// Runs only on demand (NEXQ_QUESTION_REPORT names the database), never in CI.
// Kept out of src/ so the app type-check needs no Node types.

import { describe, expect, it } from "vitest";
import { isClosingQuestion, isFeedback, lastSentence, looksLikeQuestion, whatToAnswer } from "../src/overlay/QuestionDetector";

const dbPath = process.env.NEXQ_QUESTION_REPORT;

describe.runIf(!!dbPath)("question detection on your past meetings", () => {
  it("reports what is found and what is missed", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath!, { readOnly: true });
    const rows = db
      .prepare("SELECT text FROM transcript_segments WHERE speaker IN ('Them', 'Interviewer') ORDER BY rowid")
      .all() as Array<{ text: string }>;
    db.close();

    let questions = 0, turns = 0, feedback = 0, closing = 0, nothing = 0;
    const lines: string[] = [];
    for (const { text } of rows) {
      const question = whatToAnswer(text, false);
      const turn = whatToAnswer(text, true);
      let verdict: string;
      if (question) { questions++; verdict = isClosingQuestion(question) ? (closing++, "CLOSING ") : "QUESTION"; }
      else if (turn) { turns++; verdict = "TURN    "; }
      else if (isFeedback(text)) { feedback++; verdict = "FEEDBACK"; }
      else { nothing++; verdict = "-       "; }
      const shown = question ?? turn ?? lastSentence(text);
      // A "?" in the line that no rule caught is worth a look.
      const flag = !question && /[?？]/u.test(text) && !looksLikeQuestion(lastSentence(text)) ? "  <- has '?'" : "";
      lines.push(`${verdict} ${shown.slice(0, 140)}${flag}`);
    }
    console.log(
      [
        `\n${rows.length} lines from the other party:`,
        `  ${questions} with a question (${closing} "any questions for us?")`,
        `  ${turns} answered only in "They stop talking" mode`,
        `  ${feedback} feedback left alone, ${nothing} with nothing to answer`,
        "",
        ...lines,
      ].join("\n"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});

describe.runIf(!!dbPath)("answer timings on your past meetings", () => {
  it("reports how long answers took, by action", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath!, { readOnly: true });
    const rows = db.prepare("SELECT ai_interactions FROM meetings").all() as Array<{ ai_interactions: string | null }>;
    db.close();
    type Saved = { mode: string; latency_ms?: number; first_token_ms?: number; wait_ms?: number; response?: string };
    const all: Saved[] = rows.flatMap((r) => { try { return JSON.parse(r.ai_interactions ?? "[]") as Saved[]; } catch { return []; } });
    const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : null);
    const show = (v: number | null, unit = " ms") => (v === null ? "–" : `${v}${unit}`);
    const byMode = new Map<string, Saved[]>();
    for (const s of all) byMode.set(s.mode, [...(byMode.get(s.mode) ?? []), s]);
    const lines = [...byMode].map(([mode, list]) => {
      const pick = (k: keyof Saved) => list.map((s) => s[k]).filter((v): v is number => typeof v === "number" && v > 0);
      return `  ${mode.padEnd(10)} n ${String(list.length).padStart(3)} | wait ${show(median(pick("wait_ms"))).padStart(8)} | first words ${show(median(pick("first_token_ms"))).padStart(8)} | total ${show(median(pick("latency_ms"))).padStart(8)} | ${show(median(list.map((s) => (s.response ?? "").length)), " chars")}`;
    });
    console.log([`\n${all.length} answers (medians; wait = from asking to the first words):`, ...lines].join("\n"));
    expect(all.length).toBeGreaterThanOrEqual(0);
  });
});
