// Matching a question to a prepared story by meaning, with the embedding
// model Ollama already runs for the document search: "Parle-moi d'un ratage"
// finds the "échec" story with no word in common. Word matching stays first
// (instant, no Ollama needed); this is tried when it finds nothing.

import { embedTexts } from "../lib/ipc";
import { matchStory, type StarStory } from "./storyStore";

const PREFIX = "search_query: ";

/**
 * A story answers the question when its closest text scores at least this,
 * and beats the next story by MEANING_MARGIN. Calibrated on nomic-embed-text
 * with French interview questions: matches scored 0.66-0.84 with a lead of
 * 0.026 or more, unrelated questions 0.61-0.65. A small sample: unsure cases
 * show nothing rather than a wrong story.
 */
export const MEANING_SCORE = 0.655;
export const MEANING_MARGIN = 0.02;

const vectors = new Map<string, number[]>();

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const storyTexts = (s: StarStory) => [s.title, ...s.questions].filter((t) => t.trim());

/** Embeds what isn't embedded yet (each text once per session). */
async function ensureVectors(texts: string[]): Promise<void> {
  const missing = [...new Set(texts.filter((t) => !vectors.has(t)))];
  if (missing.length === 0) return;
  const embedded = await embedTexts(missing.map((t) => PREFIX + t));
  missing.forEach((t, i) => embedded[i] && vectors.set(t, embedded[i]));
}

/** The story whose title or questions mean what `question` asks, if one clearly does. */
export function bestByMeaning(asked: number[], stories: StarStory[]): StarStory | null {
  const scored = stories
    .map((story) => ({
      story,
      score: Math.max(-1, ...storyTexts(story).map((t) => (vectors.has(t) ? cosine(asked, vectors.get(t)!) : -1))),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < MEANING_SCORE) return null;
  if (next && best.score - next.score < MEANING_MARGIN) return null;
  return best.story;
}

export async function matchStoryByMeaning(question: string, stories: StarStory[]): Promise<StarStory | null> {
  if (!question.trim() || stories.length === 0) return null;
  try {
    const known = stories.flatMap(storyTexts);
    await ensureVectors([question, ...known]);
    const asked = vectors.get(question);
    // Questions change with every word heard: keep only the stories' vectors.
    if (!known.includes(question)) vectors.delete(question);
    return asked ? bestByMeaning(asked, stories) : null;
  } catch {
    return null; // Ollama not running: word matching only
  }
}

/** The prepared story for `question`: by its words at once, else by meaning. */
export async function findStory(question: string, stories: StarStory[]): Promise<StarStory | null> {
  return matchStory(question, stories) ?? (await matchStoryByMeaning(question, stories));
}

/** For tests: forget the session's embeddings. */
export function clearMeaningCache(): void {
  vectors.clear();
}
