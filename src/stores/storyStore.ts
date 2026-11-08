// Prepared answers: STAR stories written from the CV before an interview and
// reviewed by the user. When a question matches one, its answer shows at once,
// before the AI has written anything.

import { create } from "zustand";
import type { Store } from "@tauri-apps/plugin-store";

export interface StarStory {
  id: string;
  title: string;
  /** Questions this story answers, as an interviewer would ask them. */
  questions: string[];
  /** Keywords or figures to glance at. */
  keywords: string[];
  /** The story, as the user would tell it. */
  answer: string;
}

const STORE_FILE = "stories.json";
const KEY = "stories";

let storeInstance: Store | null = null;
async function getStore(): Promise<Store> {
  if (!storeInstance) {
    const { load } = await import("@tauri-apps/plugin-store");
    storeInstance = await load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

/** The stories in the model's reply: a JSON array, possibly fenced or with text around it. */
export function parseStories(text: string): StarStory[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("The AI's reply holds no list of stories");
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("The AI's reply holds no list of stories");
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: crypto.randomUUID(),
      title: String(r.title ?? "").trim(),
      questions: strings(r.questions),
      keywords: strings(r.keywords),
      answer: String(r.answer ?? "").trim(),
    }))
    .filter((s) => s.title && s.answer);
}

// ── Matching ─────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    "le la les l un une des du de d et ou mais donc or ni car a à au aux en dans par pour sur sous avec sans ce cet cette ces " +
    "je j tu te t il elle on nous vous ils elles me m moi toi se s y que qu qui quoi dont où est es sont été être avoir as ai " +
    "avez avons ont eu fait faire fais faites ton ta tes votre vos mon ma mes son sa ses leur leurs ne n pas plus très bien " +
    "comment pourquoi quand quel quelle quels quelles est-ce qu'est-ce peux peut pouvez pourrais pourriez parle parlez raconte " +
    "racontez décris décrivez explique expliquez dis dites moi donne donnez exemple fois situation déjà alors oui ok " +
    "the a an and or but of to in on for with you your yours me my i is are was were be been do did does can could would " +
    "tell describe explain about what how why when where which who time example"
  ).split(" "),
);

/** Content words, lowercased, without accents or plural endings. */
export function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/[^\p{L}\p{N}'-]+/u)
    .flatMap((w) => w.split("'"))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => w.normalize("NFD").replace(/\p{M}/gu, "").replace(/(?:s|x)$/u, ""));
  return new Set(words);
}

/** Share of the smaller set's words the two have in common. */
function overlap(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  if (!a.size || !b.size) return { score: 0, shared: 0 };
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return { score: shared / Math.min(a.size, b.size), shared };
}

/** At least this share of words in common, and at least two words. */
export const MATCH_SCORE = 0.5;

/** The prepared story that answers `question`, if one clearly does. */
export function matchStory(question: string, stories: StarStory[]): StarStory | null {
  const asked = contentWords(question);
  if (asked.size < 2) return null;
  let best: { story: StarStory; score: number } | null = null;
  for (const story of stories) {
    for (const text of [story.title, ...story.questions]) {
      const { score, shared } = overlap(asked, contentWords(text));
      if (shared >= 2 && score >= MATCH_SCORE && (!best || score > best.score)) best = { story, score };
    }
  }
  return best?.story ?? null;
}

// ── Store ────────────────────────────────────────────────────────────

interface StoryState {
  stories: StarStory[];
  loaded: boolean;
  load: () => Promise<void>;
  setStories: (stories: StarStory[]) => void;
  updateStory: (id: string, patch: Partial<StarStory>) => void;
  removeStory: (id: string) => void;
}

function persist(stories: StarStory[]): void {
  getStore().then((s) => s.set(KEY, stories)).catch(() => {});
}

export const useStoryStore = create<StoryState>((set, get) => ({
  stories: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const store = await getStore();
      const saved = await store.get<StarStory[]>(KEY);
      set({ stories: Array.isArray(saved) ? saved : [], loaded: true });
      // Edited in the other window (Settings in the launcher): follow it.
      await store.onKeyChange<StarStory[]>(KEY, (value) => {
        if (Array.isArray(value)) set({ stories: value });
      });
    } catch {
      set({ loaded: true });
    }
  },

  setStories: (stories) => {
    set({ stories });
    persist(stories);
  },

  updateStory: (id, patch) => {
    const stories = get().stories.map((s) => (s.id === id ? { ...s, ...patch } : s));
    set({ stories });
    persist(stories);
  },

  removeStory: (id) => {
    const stories = get().stories.filter((s) => s.id !== id);
    set({ stories });
    persist(stories);
  },
}));

/** Writes stories from the CV (and the job, when given), replacing none: they are added. */
export async function generateStories(jobDescription: string, language: string): Promise<StarStory[]> {
  const { generateStarStories } = await import("../lib/ipc");
  const text = await generateStarStories(jobDescription, language);
  return parseStories(text);
}
