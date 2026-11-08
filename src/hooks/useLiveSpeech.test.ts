import { describe, expect, it } from "vitest";
import { lastSentenceEnd, speakableText } from "./useLiveSpeech";

describe("reading answers aloud", () => {
  it("reads each finished sentence, not a sentence still being written", () => {
    const text = "J'ai mené ce projet chez Capgemini. Nous avons automatisé 40 process";
    const end = lastSentenceEnd(text, 0);
    expect(text.slice(0, end)).toBe("J'ai mené ce projet chez Capgemini.");
    expect(lastSentenceEnd(text, end)).toBe(-1);
  });

  it("doesn't split numbers or versions", () => {
    expect(lastSentenceEnd("Le gain était de 3.5 jours par mois", 0)).toBe(-1);
    expect(lastSentenceEnd("On utilise UiPath v2.1 en production", 0)).toBe(-1);
  });

  it("reads a list item once its line is finished", () => {
    const text = "- Premier point\n- Second po";
    expect(text.slice(0, lastSentenceEnd(text, 0))).toBe("- Premier point\n");
  });

  it("speaks words, not markdown", () => {
    expect(speakableText("## Réponse\n- **Python** et `SQL`\n1. Voir [la doc](https://x.y)")).toBe(
      "Réponse Python et SQL Voir la doc",
    );
  });
});
