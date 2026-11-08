import { describe, expect, it } from "vitest";
import { splitCue } from "./CueLine";
import { speakableText } from "../hooks/useLiveSpeech";

describe("cue card", () => {
  it("takes the keywords line apart from the answer", () => {
    expect(splitCue("⚡ Capgemini · 40 process · **−30 %** délais\nJ'ai mené ce projet.\n\nDétails…")).toEqual({
      cue: ["Capgemini", "40 process", "−30 % délais"],
      rest: "J'ai mené ce projet.\n\nDétails…",
    });
  });

  it("shows the keywords while they are still arriving", () => {
    expect(splitCue("⚡ Capgemini · 40 pro").cue).toEqual(["Capgemini", "40 pro"]);
  });

  it("leaves an answer without a cue card alone", () => {
    expect(splitCue("J'ai mené ce projet.")).toEqual({ cue: null, rest: "J'ai mené ce projet." });
  });

  it("doesn't read the keywords aloud", () => {
    expect(speakableText("⚡ Capgemini · 40 process\nJ'ai mené ce projet.")).toBe("J'ai mené ce projet.");
  });
});
