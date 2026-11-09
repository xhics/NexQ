import { describe, expect, it } from "vitest";
import { EssentialReader, MAX_ANSWER_WORDS, essentialSpeech, shortenSentence } from "./essentialSpeech";

describe("reading the essentials aloud", () => {
  it("leaves out keywords, titles and labels, and keeps the opening sentence", () => {
    const answer = [
      "⚡ RPA · UiPath · 40 process · -30 %",
      "## Ma réponse",
      "J'ai piloté l'automatisation de 40 process chez Capgemini.",
      "**Résultat**",
      "Situation : l'équipe passait deux jours par mois sur les rapprochements.",
    ].join("\n");
    expect(essentialSpeech(answer)).toBe(
      "J'ai piloté l'automatisation de 40 process chez Capgemini. l'équipe passait deux jours par mois sur les rapprochements.",
    );
  });

  it("reads one sentence of each list item, two of a paragraph", () => {
    const answer = [
      "Premier point. Détail du premier point.",
      "- Python pour l'analyse. Pandas surtout.",
      "- SQL pour les extractions. Sur Oracle.",
    ].join("\n");
    // The paragraph line comes first, as the opening.
    expect(essentialSpeech(answer)).toBe(
      "Premier point. Détail du premier point. Python pour l'analyse. SQL pour les extractions.",
    );
  });

  it("works on the answer as it streams, piece by piece", () => {
    const reader = new EssentialReader();
    expect(reader.take("⚡ a · b\n")).toBe("");
    expect(reader.take("Je commence par le contexte.")).toBe("Je commence par le contexte.");
    expect(reader.take(" Puis le résultat.")).toBe("Puis le résultat.");
    expect(reader.take(" Et encore un détail.")).toBe("");
    expect(reader.take("\n- Un point clé.")).toBe("Un point clé.");
  });

  it("stops after about MAX_ANSWER_WORDS words", () => {
    const line = "Voici une phrase de dix mots pour tester la limite.";
    const said = essentialSpeech(Array(20).fill(line).join("\n"));
    const count = said.split(/\s+/).length;
    expect(count).toBeGreaterThanOrEqual(MAX_ANSWER_WORDS - 10);
    expect(count).toBeLessThanOrEqual(MAX_ANSWER_WORDS + 10);
  });

  it("cuts a long sentence at a comma", () => {
    const long = "J'ai repris le projet en urgence, avec une équipe de six personnes réparties sur trois pays et deux fuseaux horaires différents";
    expect(shortenSentence(long)).toBe("J'ai repris le projet en urgence, avec une équipe de six personnes réparties sur trois pays et deux…");
    const withLateComma = "Nous avons livré la première version du produit en six semaines au lieu de trois mois, grâce à une méthode agile";
    expect(shortenSentence(withLateComma)).toBe("Nous avons livré la première version du produit en six semaines au lieu de trois mois.");
  });

  it("skips code and tables", () => {
    expect(essentialSpeech("```\nSELECT 1;\n```\n| a | b |\nLa requête renvoie un.")).toBe("La requête renvoie un.");
  });
});
