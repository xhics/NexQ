import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake embeddings: a text's vector is set by the words it carries.
const AXES = ["échec|ratage|mal tourné", "agent|garde-fou", "salaire|prétentions"];
function vec(text: string): number[] {
  const t = text.toLowerCase();
  return AXES.map((axis) => (new RegExp(axis).test(t) ? 1 : 0.05)).concat([0.2]);
}
const embedTexts = vi.hoisted(() => vi.fn());
vi.mock("../lib/ipc", () => ({ embedTexts }));

import { bestByMeaning, clearMeaningCache, cosine, findStory, matchStoryByMeaning } from "./storyMeaning";
import type { StarStory } from "./storyStore";

const story = (id: string, title: string, questions: string[]): StarStory => ({ id, title, questions, keywords: [], answer: id });
const stories = [
  story("echec", "Échec d'un projet IA", ["Raconte-moi un échec"]),
  story("agent", "Architecture agentique", ["Quels garde-fous sur un agent"]),
];

beforeEach(() => {
  clearMeaningCache();
  embedTexts.mockReset().mockImplementation(async (texts: string[]) => texts.map(vec));
});

describe("prepared stories by meaning", () => {
  it("measures closeness", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("finds the story a question means, with no word in common with it", async () => {
    expect((await matchStoryByMeaning("Parle-moi d'un ratage", stories))?.id).toBe("echec");
  });

  it("shows nothing when no story is close enough, or two are as close", async () => {
    expect(await matchStoryByMeaning("Tes prétentions de salaire", stories)).toBeNull();
    expect(bestByMeaning([1, 1, 0, 0], [stories[0], { ...stories[0], id: "twin" }])).toBeNull();
  });

  it("embeds each story text once, and doesn't keep the questions", async () => {
    await matchStoryByMeaning("Parle-moi d'un ratage", stories);
    await matchStoryByMeaning("Une fois où ça a mal tourné", stories);
    const sent = embedTexts.mock.calls.flatMap(([texts]) => texts as string[]);
    expect(sent.filter((t) => t.includes("Raconte-moi un échec"))).toHaveLength(1);
    expect(sent.every((t) => t.startsWith("search_query: "))).toBe(true);
  });

  it("matches by words first, without Ollama", async () => {
    embedTexts.mockRejectedValue(new Error("Ollama isn't running"));
    expect((await findStory("Raconte-moi un échec que tu as vécu sur un projet", stories))?.id).toBe("echec");
    expect(await findStory("Parle-moi d'un ratage", stories)).toBeNull();
  });
});
