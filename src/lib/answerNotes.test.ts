import { expect, it } from "vitest";
import { NOTES_MARK, splitNotes, withoutNotes } from "./answerNotes";

it("takes the notes off the answer", () => {
  const text = `Je commencerais par les logs.\n\n${NOTES_MARK}\n- p95 latence\n- outbox pattern`;
  expect(splitNotes(text)).toEqual({ answer: "Je commencerais par les logs.", notes: ["p95 latence", "outbox pattern"] });
});

it("gathers a continuation's notes too, and keeps its words in the answer", () => {
  const text = `Début.\n${NOTES_MARK}\n- note 1\n\nSuite de la réponse.\n${NOTES_MARK}\n- note 2`;
  expect(splitNotes(text)).toEqual({ answer: "Début.\n\nSuite de la réponse.", notes: ["note 1", "note 2"] });
});

it("hides the marker while it is still arriving", () => {
  expect(withoutNotes("Une réponse.\n---NO")).toBe("Une réponse.");
  expect(withoutNotes("Une réponse.")).toBe("Une réponse.");
});
