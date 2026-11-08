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
