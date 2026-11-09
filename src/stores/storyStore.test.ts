import { describe, expect, it } from "vitest";
import { matchStory, parseStories, type StarStory } from "./storyStore";

const story = (title: string, questions: string[]): StarStory => ({
  id: title, title, questions, keywords: [], answer: `${title}…`,
});

const stories = [
  story("Échec d'un projet IA", [
    "Parle-moi d'un projet d'automatisation avec de l'IA qui n'a pas marché comme prévu",
    "Raconte-moi un échec et ce que tu en as appris",
  ]),
  story("Choix d'architecture agentique", [
    "Comment tu choisis entre un workflow classique et une approche agentique avec des LLM",
    "Quels garde-fous tu mets sur un agent LLM en production",
  ]),
  story("Résilience des intégrations", [
    "Comment tu assures la résilience face aux pannes d'API et aux timeouts",
  ]),
];

describe("prepared stories", () => {
  it("reads the AI's list, even fenced or with text around it", () => {
    const parsed = parseStories('Voici :\n```json\n[{"title":"Échec","questions":["Q1"],"keywords":["k"],"answer":"A"},{"title":"","answer":""}]\n```');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ title: "Échec", questions: ["Q1"], keywords: ["k"], answer: "A" });
    expect(() => parseStories("Désolé, je ne peux pas.")).toThrow();
  });

  it("finds the story a question asks for, worded differently", () => {
    expect(matchStory("Oui, nouvelle question. Parle-moi d'un projet où tu as introduit de l'automatisation avec de l'IA et où ça n'a pas marché", stories)?.title)
      .toBe("Échec d'un projet IA");
    expect(matchStory("Ok, et si tu partais sur l'agent, quel garde-fou concret tu mettais en production", stories)?.title)
      .toBe("Choix d'architecture agentique");
    expect(matchStory("Comment tu t'assures que tes systèmes résistent aux pannes d'API", stories)?.title)
      .toBe("Résilience des intégrations");
  });

  it("shows nothing when no story clearly answers", () => {
    expect(matchStory("Quelles sont tes prétentions salariales", stories)).toBeNull();
    expect(matchStory("Pourquoi nous", stories)).toBeNull();
  });
});

describe("your style, from your edits", () => {
  const base = { id: "s", title: "T", questions: [], keywords: [] };
  const before = "Nous avons mis en place une plateforme d'automatisation qui a permis de réduire les délais de traitement des factures de manière significative pour le client.";

  it("keeps the AI's version of what it writes", () => {
    expect(parseStories('[{"title":"T","answer":"A"}]')[0].original).toBe("A");
  });

  it("counts answers you rewrote, not ones you only touched", async () => {
    const { styleEdits } = await import("./storyStore");
    const rewritten = "J'ai mis en place une plateforme d'automatisation : −30 % de délais sur les factures en six mois.";
    const touched = before.replace("significative", "nette");
    expect(styleEdits([
      { ...base, answer: rewritten, original: before },
      { ...base, id: "t", answer: touched, original: before },
      { ...base, id: "u", answer: before, original: before },
      { ...base, id: "v", answer: rewritten },
    ])).toEqual([{ before, after: rewritten }]);
  });

  it("puts the rules in their own block of the instructions, replaced or removed later", async () => {
    const { styleBlockOf, withStyleBlock } = await import("./storyStore");
    const mine = "Je suis architecte GenAI.";
    const once = withStyleBlock(mine, "- Utilise je, pas nous");
    expect(once.startsWith(mine)).toBe(true);
    expect(styleBlockOf(once)).toBe("- Utilise je, pas nous");
    const twice = withStyleBlock(once, "- Un chiffre par réponse");
    expect(styleBlockOf(twice)).toBe("- Un chiffre par réponse");
    expect(twice.match(/Mon style, appris/g)).toHaveLength(1);
    expect(withStyleBlock(twice, "")).toBe(mine);
  });

  it("keeps the job applied for in its own block, beside the style", async () => {
    const { jobBlockOf, styleBlockOf, withJobBlock, withStyleBlock } = await import("./storyStore");
    const styled = withStyleBlock("Je suis architecte GenAI.", "- Utilise je");
    const aimed = withJobBlock(styled, "Architecte GenAI chez Acme");
    expect(jobBlockOf(aimed)).toBe("Architecte GenAI chez Acme");
    expect(styleBlockOf(aimed)).toBe("- Utilise je");
    expect(jobBlockOf(withJobBlock(aimed, "Lead MLOps"))).toBe("Lead MLOps");
    expect(withJobBlock(aimed, "")).toBe(styled);
  });
});
