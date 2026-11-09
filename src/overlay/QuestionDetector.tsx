import { useEffect, useRef, useCallback } from "react";
import { HelpCircle, Sparkles, Check, Clock, X } from "lucide-react";
import { onQuestionDetected, onTranscriptFinal, onTranscriptUpdate } from "../lib/events";
import { runUserAction } from "../lib/userAction";
import {
  REFUSED, answerRunning, autoAnswerRunning, decideTurnStep, inTurn, isBackchannel, logAutoAnswer, runYourAction,
  haltAutoAnswer, keepToContinue, sameQuestion, samePoint, stopAutoAnswer,
} from "../lib/autoAnswer";
import { useTranscriptStore } from "../stores/transcriptStore";
import { isSpeakingAnswer } from "../hooks/useLiveSpeech";
import { wordsSaidSinceAnswer } from "../hooks/useSaidSinceAnswer";
import { withoutNotes } from "../lib/answerNotes";
import { useAIActionsStore } from "../stores/aiActionsStore";
import { useQuestionStore } from "../stores/questionStore";
import { NOTHING_MARK, REDO_MARK, answeredNothing, useStreamStore } from "../stores/streamStore";
import { showToast } from "../stores/toastStore";
import type { DetectedQuestion, TranscriptSegment, TranscriptUpdateEvent } from "../lib/types";

/**
 * Quiet time after the other party's last words before Auto-Trigger answers
 * their question, so a question still being asked isn't answered half-way.
 */
export const AUTO_TRIGGER_DELAY_MS = 1500;
/**
 * The same wait for a sentence the transcriber closed with a question mark:
 * it marks the end of a question, so less quiet is needed to be sure.
 */
export const QUICK_TRIGGER_DELAY_MS = 900;

/** How long Auto-Trigger waits after the other party's last words before answering `question`. */
export function quietWait(question: string): number {
  return /[?？]\s*$/u.test(question) ? QUICK_TRIGGER_DELAY_MS : AUTO_TRIGGER_DELAY_MS;
}

const isOtherParty = (speaker: string) => speaker === "Them" || speaker === "Interviewer";

// Chinese and Japanese question signals, kept in step with
// src-tauri/src/intelligence/question_detector.rs.
const CHINESE_QUESTION_WORDS = ["什么", "什麼", "怎么", "怎麼", "为什么", "為什麼", "哪", "谁", "誰", "多少", "如何"];
// A question word meaning "any" or "no matter" (没什么问题, 无论如何) doesn't ask anything.
const CHINESE_NON_QUESTION_PHRASES = [
  "没什么", "沒什麼", "什么都", "什麼都", "什么也", "什麼也", "不怎么", "不怎麼",
  "哪怕", "谁都", "誰都", "谁也", "誰也", "无论", "無論", "不管", "多多少少",
];
// A bare か also ends ordinary words (静か, 確か, とか).
const JAPANESE_QUESTION_ENDINGS = ["ですか", "ますか", "ませんか", "でしたか", "ましたか", "でしょうか", "ましょうか", "のか", "ないか"];

// A tag on its own ("Right?", "You know?") asks nothing the AI could answer.
const TAG_QUESTIONS = new Set([
  "right", "okay", "ok", "yeah", "yep", "yes", "no", "nope", "sure", "correct", "true", "really",
  "agreed", "alright", "all right", "huh", "hmm", "hm", "eh", "see", "you see", "you know",
  "isn't it", "sorry", "pardon", "hello", "cool", "good",
  "d'accord", "hein", "voilà", "c'est ça", "n'est-ce pas", "oui", "non", "vraiment", "allô", "bon",
  "tu vois", "vous voyez", "ça va", "c'est bon", "tu sais", "vous savez",
]);
const TAG_LEAD_INS = new Set([
  "and", "so", "but", "well", "oh", "um", "uh", "okay", "ok", "yeah", "yes", "no",
  "et", "donc", "mais", "alors", "bon", "euh", "oui", "non", "ah",
]);

function isTagQuestion(sentence: string): boolean {
  const words = sentence.toLowerCase().replace(/’/g, "'").split(/[\s,.?？!…]+/u).filter(Boolean);
  while (words.length > 1 && TAG_LEAD_INS.has(words[0])) words.shift();
  return TAG_QUESTIONS.has(words.join(" "));
}

function isCjkQuestion(sentence: string): boolean {
  const body = sentence.replace(/[.!。！…]+$/u, "");
  return /[吗嗎呢]$/u.test(body)
    || JAPANESE_QUESTION_ENDINGS.some((ending) => body.endsWith(ending))
    || (CHINESE_QUESTION_WORDS.some((word) => body.includes(word))
      && !CHINESE_NON_QUESTION_PHRASES.some((phrase) => body.includes(phrase)));
}

// French question signals, kept in step with
// src-tauri/src/intelligence/question_detector.rs. French STT rarely writes the
// question mark, and spoken questions come after openers ("Oui, deuxième
// question, comment tu…"), so each clause of the sentence is checked.

/** Words that ask at the start of a clause, after openers like "Oui," or "Alors,". */
const FRENCH_CLAUSE_STARTERS = [
  "comment", "pourquoi", "combien", "lequel", "laquelle", "lesquels", "lesquelles",
  "parlez-moi", "parle-moi", "racontez-moi", "raconte-moi", "expliquez-moi", "explique-moi", "expliquez", "explique",
  "décrivez", "décrivez-moi", "décris", "décris-moi", "dites-moi", "dis-moi", "présentez-vous", "présente-toi",
  "donnez-moi", "donne-moi", "citez-moi", "cite-moi", "citez", "cite",
  // Asking for more on the answer you gave: "précise", "développe", "conclus".
  "précise", "précisez", "détaille", "détaillez", "développe", "développez", "illustre", "illustrez",
  "conclus", "concluez", "résume", "résumez", "approfondis", "approfondissez",
];
/**
 * Spoken yes/no questions without inversion or a question word, at a clause's
 * start: "tu peux être plus précis", "vous avez déjà géré une crise",
 * "prends le temps de conclure".
 */
const FRENCH_CLAUSE_OPENERS = [
  "tu peux", "tu pourrais", "tu pourras", "vous pouvez", "vous pourriez", "tu as déjà", "t'as déjà", "vous avez déjà",
  "tu aurais", "vous auriez", "tu connais", "vous connaissez", "tu ferais", "vous feriez", "tu saurais", "vous sauriez",
  "tu veux bien", "vous voulez bien", "tu te souviens", "vous vous souvenez", "tu es déjà", "vous êtes déjà",
  "prends le temps", "prenez le temps",
];
/** Ask only as the sentence's first word: inside a sentence they link ("un projet où…"). */
const FRENCH_FIRST_WORD_STARTERS = ["où", "d'où", "qui", "quoi"];
/** "Quel…" asks when it is about you: "quelle décision tu as prise", not "quelle chance". */
const FRENCH_QUEL = new Set(["quel", "quelle", "quels", "quelles"]);
const FRENCH_YOU = /(^|[\s'])(tu|t'|toi|ton|ta|tes|vous|votre|vos)(?=[\s'.,;:!?]|$)/u;
const FRENCH_QUEL_VERBS = /^quel(le)?s? (est|sont|serait|seraient|était|étaient|a été|ont été|sera|seront)(?=\s|$)/u;
const FRENCH_PATTERNS = [
  "est-ce que", "est-ce qu'", "qu'est-ce", "un exemple concret", "un exemple précis",
  "nouvelle question", "question suivante", "prochaine question", "première question", "deuxième question",
  "troisième question", "quatrième question", "cinquième question", "dernière question", "autre question",
  "passons à une question", "passons à la question", "j'ai une question", "une question plus", "une question un peu",
  "j'aimerais savoir", "je voudrais savoir", "j'aimerais comprendre", "je voudrais comprendre",
  "je vous écoute", "je t'écoute",
];
const FRENCH_LEAD_INS = new Set(["et", "mais", "donc", "alors", "puis", "ok", "okay", "bon", "oui", "ouais", "bien"]);
// Inversion ("avez-vous", "pensez-vous", "a-t-il") asks; "rendez-vous" doesn't.
const FRENCH_INVERSION = /(^|\s)(?!rendez-vous)\p{L}+-(vous|tu|t-il|t-elle|t-on)(\s|$)/u;

/** Ask at the end of a spoken question: "tu fais quoi", "vous feriez comment", "c'est quoi". */
const FRENCH_END_WORDS = new Set(["quoi", "comment", "pourquoi", "combien", "quand", "où", "lequel", "laquelle", "lesquels", "lesquelles"]);
/** Who is asked, or what about, just before that word. */
const FRENCH_END_SUBJECT = /^(tu|t'|toi|vous|on|c'est|ça|ca|cela)$/u;
/** Acknowledgements the transcriber glues after the question ("…tu fais quoi oui"). */
const FRENCH_TRAILING_TAGS = new Set(["oui", "ouais", "ok", "okay", "d'accord", "hein", "bon", "voilà", "alors", "euh", "là", "donc", "exactement"]);

/** "…mais que les coûts dépassent le budget, tu fais quoi (oui)": the asking word comes last. */
function frenchEndAsks(text: string): boolean {
  const words = text.split(/[\s,;:.!…]+/u).filter(Boolean);
  while (words.length > 0 && FRENCH_TRAILING_TAGS.has(words[words.length - 1])) words.pop();
  if (words.length < 3 || !FRENCH_END_WORDS.has(words[words.length - 1])) return false;
  // "tu fais quoi", "vous feriez comment", "ça sert à quoi" (the subject within the 4 words before).
  // Not "je t'explique comment": you telling, not them asking.
  const before = words.slice(-5, -1);
  if (before.some((w) => w === "je" || w.startsWith("j'"))) return false;
  return before.some((w) => FRENCH_END_SUBJECT.test(w) || /^(t'|c')/u.test(w));
}

function frenchClauseAsks(clause: string, first: boolean): boolean {
  const words = clause.split(/\s+/u).filter(Boolean);
  while (words.length > 1 && FRENCH_LEAD_INS.has(words[0])) words.shift();
  const head = words[0] ?? "";
  if (FRENCH_CLAUSE_STARTERS.includes(head)) return true;
  const opening = words.join(" ");
  if (FRENCH_CLAUSE_OPENERS.some((o) => opening === o || opening.startsWith(`${o} `))) return true;
  if (first && FRENCH_FIRST_WORD_STARTERS.includes(head)) return true;
  if (FRENCH_QUEL.has(head)) {
    const rest = words.join(" ");
    return FRENCH_QUEL_VERBS.test(rest) || FRENCH_YOU.test(rest);
  }
  return false;
}

export function isFrenchQuestion(lower: string): boolean {
  const text = lower.replace(/’/g, "'").replace(/[.!…]+$/u, "");
  if (FRENCH_PATTERNS.some((p) => text.includes(p)) || FRENCH_INVERSION.test(text) || frenchEndAsks(text)) return true;
  return text.split(/[,;:]+/u).some((clause, i) => frenchClauseAsks(clause.trim(), i === 0));
}

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (isTagQuestion(trimmed)) return false;
  if (/[?？]$/u.test(trimmed) || isCjkQuestion(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  const qWords = [
    "what ", "how ", "why ", "when ", "where ", "who ", "which ",
    "can you", "could you", "would you", "do you", "are you",
    "is there", "have you", "tell me", "explain",
  ];
  return qWords.some((w) => lower.startsWith(w)) || isFrenchQuestion(lower);
}

/**
 * The newest sentence of a transcript line. Lines grow into paragraphs, so a
 * question is usually the last sentence, not the whole line. A tag after it
 * ("Is that what you meant? Right?") doesn't count as the newest sentence.
 */
export function lastSentence(text: string): string {
  const sentences = text.trim().match(/[^.?!。？！\n]+[.?!。？！]*/gu) ?? [];
  let last = sentences.length - 1;
  while (last > 0 && isTagQuestion(sentences[last])) last--;
  const newest = (sentences[last] ?? "").trim();
  // A short request after the question ("…des données incohérentes. Un exemple
  // concret s'il te plaît.") belongs to it.
  if (last > 0 && newest.split(/\s+/u).length <= 8) {
    const before = sentences[last - 1].trim();
    if (looksLikeQuestion(before)) return `${before} ${newest}`;
  }
  return newest;
}

/** Fewest words a turn needs to be answered when it holds no question ("Oui, vas-y" isn't). */
export const TURN_MIN_WORDS = 4;

/**
 * What to answer in a line from the other party: its question, or with
 * `everyTurn` (answer whenever they stop talking) what they just said, up to
 * its last three sentences. Null when there is nothing to answer.
 */
export function whatToAnswer(text: string, everyTurn: boolean): string | null {
  const sentence = lastSentence(text);
  if (sentence && looksLikeQuestion(sentence)) return sentence;
  const sentences = (text.trim().match(/[^.?!。？！\n]+[.?!。？！]*/gu) ?? []).map((s) => s.trim()).filter(Boolean);
  // "Passons à une question plus stratégique. Tu arrives sur un projet…": the
  // question is announced, then set out as a scenario. Answer the whole of it.
  for (let i = sentences.length - 2; i >= Math.max(0, sentences.length - 6); i--) {
    if (/\bquestions?\b/u.test(sentences[i].toLowerCase()) && looksLikeQuestion(sentences[i])) {
      return sentences.slice(i).join(" ").slice(0, 600);
    }
  }
  if (!everyTurn) return null;
  const tail: string[] = [];
  for (let i = sentences.length - 1; i >= 0 && tail.length < 3; i--) {
    tail.unshift(sentences[i]);
    if (tail.join(" ").length >= 400) break;
  }
  const said = tail.join(" ");
  if (isTagQuestion(said) || isBackchannel(said) || said.split(/\s+/u).filter(Boolean).length < TURN_MIN_WORDS) return null;
  if (isFeedback(said)) return null;
  return said;
}

// An evaluator's feedback or "let me check" asks for no answer. A question
// in the same turn is found first, so "Bonne réponse. Question suivante…" is answered.
const FEEDBACK_PATTERNS = [
  /\b(sur dix|sur 10)\b/u, /\b\d+(?:[.,]\d+)?\s*\/\s*10\b/u, /\b(très )?bonne réponse\b/u, /\bje (te|vous) (donne|mets)\b/u,
  /\bje (regarde|vérifie|note|synthétise|reviens|réfléchis)\b/u, /\bj'évalue\b/u, /\bje (te|vous) fais un retour\b/u,
  /\b(out of ten|out of 10|good answer|great answer|let me check|let me think)\b/u,
];

/** Whether a turn is feedback or a hold ("je regarde", "huit sur dix"), not something to answer. */
export function isFeedback(text: string): boolean {
  const lower = text.toLowerCase().replace(/’/g, "'");
  return FEEDBACK_PATTERNS.some((re) => re.test(lower));
}

const CLOSING_QUESTIONS = [
  /\b(avez-vous|as-tu|vous avez|tu as|aurais-tu|auriez-vous)\b[^.?!]*\bdes questions\b/u,
  /\bdes questions (pour nous|pour moi|à (me|nous) poser|de (ton|votre) côté)(?!\p{L})/u,
  /\b(une|d'autres|des) questions\?? ?(de (ton|votre) côté|pour (nous|moi))(?!\p{L})/u,
  /\b(do you have|have you got|any) (any )?questions( for (us|me))?\b/u,
];

/** "Avez-vous des questions pour nous ?": the moment to ask yours, not to answer. */
export function isClosingQuestion(text: string): boolean {
  const lower = text.toLowerCase().replace(/’/g, "'");
  return CLOSING_QUESTIONS.some((re) => re.test(lower));
}

/**
 * A question this long (words), still being asked, is clear enough for a
 * first draft of the answer: you have something to start with at once.
 */
export const DRAFT_MIN_WORDS = 6;
/** A draft is continued by the answer to the question it began (the same line, or the next one when the transcriber split it) if it is this recent. */
export const DRAFT_KEEP_MS = 20_000;
/** Longest wait for the short draft to finish before its rest is written. */
const DRAFT_FINISH_WAIT_MS = 6000;

/** The request for a draft: the question as heard so far, and only an opening. */
export function draftRequest(question: string): string {
  return `${question}\n\n[The other person is still asking this question. Write only the start of the answer: the keywords line if you use one, then one or two short sentences the user can say right away. Stop there.]`;
}

/** The request for the rest of a draft, once the question is complete. */
export function continuationRequest(question: string, draft: string): string {
  return `${question}\n\n[The other person has finished asking. The user's screen already shows the start of the answer, quoted below, written while the question was still being asked. Write only what comes next for the complete question: two or three short lines (or sentences, if the start tells a story), without repeating the start, with no keywords line and no title. Only if that start answers a clearly different question (a big gap between the idea understood at first and the complete question), write ${REDO_MARK} alone on the first line, then the whole answer anew.]\n\nStart already on screen:\n"""\n${withoutNotes(draft).trim()}\n"""`;
}

/**
 * An answer this recent that you haven't started saying goes on with what
 * the other party adds (a question the transcriber split in two lines, a
 * detail), instead of being replaced.
 */
export const FOLLOW_ON_MS = 30_000;
/** Once you have said this many words of the answer, what they say next gets its own answer. */
const FOLLOW_ON_MAX_SAID = 12;

/**
 * The request for what the other party added after an answer: nothing new
 * keeps it (NOTHING_MARK), more adds to it, and only a clearly other
 * question rewrites it (REDO_MARK).
 */
export function followOnRequest(said: string, onScreen: string): string {
  return `${said}\n\n[The other person said this after the answer on the user's screen (quoted below) was written for what they said before. If it asks nothing new (feedback, an acknowledgement, a repeat, the same question in other words), reply with only ${NOTHING_MARK}. If it adds to the question or asks a little more, write only what comes next: one to three short lines, without repeating what is on screen, with no keywords line and no title. Only if it is clearly another question, so different that the answer on screen no longer fits at all, write ${REDO_MARK} alone on the first line, then the whole answer anew.]\n\nAnswer already on screen:\n"""\n${withoutNotes(onScreen).trim()}\n"""`;
}

/**
 * The request for a turn the rules don't see as a question: the AI answers
 * only if something was asked of the user, else NOTHING_MARK alone.
 */
export function unsureRequest(said: string): string {
  return `${said}\n\n[This is what the other person just said; it may or may not ask the user something. If it asks the user anything to answer now (a question, a request to tell, explain, clarify, give more or conclude), answer it as usual. If it asks nothing (feedback, a comment, an acknowledgement, a thought not finished yet), reply with only ${NOTHING_MARK} and nothing else.]`;
}

/** Whether the AI judges the other party's turns the rules don't see as questions. */
const judgesUnclear = () => {
  const d = useAIActionsStore.getState().configs.globalDefaults;
  return d.autoTrigger && d.autoAnswerTrigger !== "turn" && (d.autoAnswerUnsure ?? true);
};

/** Whether Auto-Answer answers every turn of the other party, not just questions. */
const answersEveryTurn = () => {
  const d = useAIActionsStore.getState().configs.globalDefaults;
  return d.autoTrigger && d.autoAnswerTrigger === "turn";
};

/** The mode automatic answers use, for `question`. */
function autoMode(question: string): string {
  // "Do you have any questions for us?": suggest questions to ask, not an answer.
  return isClosingQuestion(question)
    ? "FollowUp"
    : useAIActionsStore.getState().configs.globalDefaults.autoAnswerMode ?? "Assist";
}

/**
 * The automatic answer what they say now goes on from, if any: a recent
 * draft, or a recent answer you haven't started saying.
 */
function answerToGoOn() {
  const ref = useQuestionStore.getState().autoAnswer;
  if (!ref) return null;
  const age = Date.now() - (ref.startedAt ?? 0);
  if (ref.draft) return age < DRAFT_KEEP_MS ? ref : null;
  return age < FOLLOW_ON_MS && wordsSaidSinceAnswer() < FOLLOW_ON_MAX_SAID ? ref : null;
}

/**
 * A first draft of the answer while the question is still being asked (the
 * line's newest words already look like a question): the opening shows at
 * once, and the rest is added once the other party has finished.
 */
function startDraft(question: string, segmentId: string) {
  const store = useQuestionStore.getState();
  if (answerRunning() || store.paused || isSpeakingAnswer()) return;
  // An answer for what they said just before is on screen: what they add now
  // goes on from it once they finish, it isn't replaced by a new draft.
  if (answerToGoOn()) return;
  const requestId = crypto.randomUUID();
  const done = runUserAction(autoMode(question), draftRequest(question), { requestId }).catch(() => {
    const now = useQuestionStore.getState();
    if (now.autoAnswer?.requestId === requestId) now.setAutoAnswer(null);
  });
  store.setAutoAnswer({ requestId, segmentId, question, early: true, draft: true, startedAt: Date.now(), done });
  logAutoAnswer("drafted");
}

/**
 * Starts an automatic answer to `question` (a line's question), unless another
 * answer is running: then the question stays a card to click. After a draft
 * of it, the answer goes on from the draft instead of starting over.
 */
async function startAutoAnswer(question: DetectedQuestion, segmentId: string | undefined, early: boolean, detail?: string) {
  const base = answerToGoOn();
  if (base && useStreamStore.getState().isRunning(base.requestId)) {
    // Still being written: let it finish (it is short), else stop it where it is, kept.
    await Promise.race([base.done, new Promise((resolve) => setTimeout(resolve, DRAFT_FINISH_WAIT_MS))]);
    if (useStreamStore.getState().isRunning(base.requestId)) await haltAutoAnswer(base);
  }
  const store = useQuestionStore.getState();
  if (answerRunning()) {
    store.holdBack(segmentId, question.text);
    logAutoAnswer("held");
    return;
  }
  if (segmentId !== undefined) store.answerLine(question, segmentId);
  const requestId = crypto.randomUUID();
  const stream = useStreamStore.getState();
  /** Once it settles: if it found nothing to add or answer, the line is no card to click. */
  const settle = (asked: Promise<void>) => asked.then(() => {
    if (!answeredNothing(requestId)) return;
    logAutoAnswer("notAsked");
    const now = useQuestionStore.getState();
    if (question.unsure && segmentId !== undefined) now.dismissLine(segmentId);
    if (now.autoAnswer?.requestId === requestId) now.setAutoAnswer(base ? { ...base, done: Promise.resolve() } : null);
  });
  const refused = (err: unknown) => {
    // Refused: an answer started elsewhere in the meantime.
    if (!String(err).includes(REFUSED)) return;
    const now = useQuestionStore.getState();
    now.holdBack(segmentId, question.text);
    if (now.autoAnswer?.requestId === requestId) now.setAutoAnswer(null);
    logAutoAnswer("held");
  };

  // An answer is on screen for what they said just before: go on from it,
  // rewrite it only if they asked something clearly else.
  // (Its text, even when it was stopped before it was kept in History.)
  const onScreen = base && !stream.error ? stream.currentContent : "";
  if (base && onScreen.trim()) {
    stream.markContinuation(requestId);
    const request = base.draft ? continuationRequest(question.text, onScreen) : followOnRequest(question.text, onScreen);
    const done = settle(runUserAction(autoMode(question.text), request, { requestId }).catch(refused));
    // The window runs from the first answer: a long exchange gets fresh answers again.
    if (segmentId !== undefined) store.setAutoAnswer({ requestId, segmentId, question: question.text, early, startedAt: base.startedAt, done });
    logAutoAnswer(base.draft ? "continued" : "followOn", detail);
    return;
  }

  if (question.unsure) {
    // The AI judges: an answer if something was asked, else the screen stays.
    stream.markTentative(requestId);
    const done = settle(runUserAction(autoMode(question.text), unsureRequest(question.text), { requestId }).catch(refused));
    if (segmentId !== undefined) store.setAutoAnswer({ requestId, segmentId, question: question.text, early, tentative: true, startedAt: Date.now(), done });
    logAutoAnswer("unsure", detail);
    return;
  }
  const done = runUserAction(autoMode(question.text), question.text, { requestId }).catch(refused);
  if (segmentId !== undefined) store.setAutoAnswer({ requestId, segmentId, question: question.text, early, startedAt: Date.now(), done });
  logAutoAnswer(early ? "early" : "answered", detail);
}

/** Auto-Answer for a line that carries the provider's turn signal. */
async function onTurnSignal(seg: TranscriptSegment, signalAt: number) {
  if (!seg.turn || !useAIActionsStore.getState().configs.globalDefaults.autoTrigger) return;
  const store = useQuestionStore.getState();
  // Paused, or NexQ's own voice may be what was heard.
  if (store.paused || isSpeakingAnswer()) return;
  const question = whatToAnswer(seg.text, answersEveryTurn());
  const current = store.autoAnswer;
  const step = decideTurnStep(seg.turn, seg.id, question, current);
  if (step.kind === "none") return;
  if (step.kind === "confirm") {
    if (current) store.setAutoAnswer({ ...current, early: false });
    logAutoAnswer("kept");
    return;
  }
  // The question grew after the early answer: it stays, and the answer goes on from it.
  if (current && step.kind === "answer" && step.replaces) {
    await keepToContinue(current);
  } else if (current && (step.kind === "withdraw" || step.replaces)) {
    // The early answer was premature: it gives way.
    store.setAutoAnswer(null);
    if (step.kind === "withdraw") store.holdBack(seg.id, current.question);
    logAutoAnswer("withdrawn");
    await stopAutoAnswer(current);
  }
  if (step.kind === "answer") {
    const q = { text: step.question, confidence: 0.9, timestamp_ms: seg.timestamp_ms, source: seg.speaker };
    await startAutoAnswer(q, seg.id, step.early, `${seg.turn}, ${Date.now() - signalAt} ms after the signal`);
  }
}

/** The overlay's question card, unless question detection is off. */
export function QuestionPanel() {
  const questionDetection = useAIActionsStore((s) => s.configs.globalDefaults.questionDetection);
  if (!questionDetection) return null;
  return (
    <div className="shrink-0 rounded-xl border border-info/10 bg-info/5 px-4 py-3">
      <QuestionDetector />
    </div>
  );
}

export function QuestionDetector() {
  const questions = useQuestionStore((s) => s.questions);
  const addQuestion = useQuestionStore((s) => s.addQuestion);
  const justMountedRef = useRef(true);
  const segments = useTranscriptStore((s) => s.segments);
  const autoTriggerOn = useAIActionsStore((s) => s.configs.globalDefaults.autoTrigger);
  const everyTurn = useAIActionsStore((s) => s.configs.globalDefaults.autoTrigger && s.configs.globalDefaults.autoAnswerTrigger === "turn");
  const paused = useQuestionStore((s) => s.paused);
  const autoTrigger = autoTriggerOn && !paused;
  // Changes whenever the other party says more (a new line, or a line growing).
  const otherPartyActivity = useTranscriptStore((s) => {
    for (let i = s.segments.length - 1; i >= 0; i--) {
      const seg = s.segments[i];
      if (isOtherParty(seg.speaker)) return `${seg.id}:${seg.text.length}`;
    }
    return "";
  });

  useEffect(() => {
    const p = onQuestionDetected((event) => {
      if (isOtherParty(event.source)) {
        addQuestion(event);
      }
    });
    return () => { p.then((u) => u()); };
  }, [addQuestion]);

  // Providers that detect turns (Cartesia, Deepgram Flux): answer on their
  // "done", or early on "probably done", instead of waiting for quiet.
  useEffect(() => {
    if (!autoTrigger) return;
    const onLine = ({ segment }: TranscriptUpdateEvent) => {
      if (!segment.turn || !isOtherParty(segment.speaker)) return;
      useQuestionStore.getState().markTurnLine(segment.id);
      const at = Date.now();
      void inTurn(() => onTurnSignal(segment, at));
    };
    const updates = onTranscriptUpdate(onLine);
    const finals = onTranscriptFinal(onLine);
    return () => {
      updates.then((u) => u());
      finals.then((u) => u());
    };
  }, [autoTrigger]);

  useEffect(() => {
    const store = useQuestionStore.getState();
    const { checkLine, panelSeen, setPanelSeen, holdBackUnanswered } = store;
    for (const seg of segments) {
      if (!seg.is_final || !checkLine(seg.id, seg.text)) continue;
      if (!isOtherParty(seg.speaker)) continue;
      const sentence = whatToAnswer(seg.text, everyTurn);
      // No question by the rules, but they said something: the AI judges.
      if (!sentence && autoTrigger && judgesUnclear() && !isSpeakingAnswer() && !store.isTurnLine(seg.id)) {
        const said = whatToAnswer(seg.text, true);
        if (said) addQuestion({ text: said, confidence: 0.5, timestamp_ms: seg.timestamp_ms, source: seg.speaker, unsure: true }, seg.id);
      }
      // While NexQ reads an answer aloud, the other party's channel hears it too.
      if (sentence && !isSpeakingAnswer()) {
        addQuestion({ text: sentence, confidence: 0.8, timestamp_ms: seg.timestamp_ms, source: seg.speaker }, seg.id);
        // The line grew into another question after Auto-Answer answered it:
        // that answer stops but stays on screen, and the answer to the whole
        // question goes on from it (or starts over, if it misread). (Lines
        // with turn signals are handled on those signals.)
        const ref = store.autoAnswer;
        // "Oui", "d'accord" or a corrected word isn't another question: the
        // answer on screen stays.
        // A draft is meant to grow with its question: its rest comes after.
        if (autoTrigger && ref && !ref.draft && ref.segmentId === seg.id && !samePoint(ref.question, sentence) && !store.isTurnLine(seg.id)) {
          store.reviseLine(seg.id, sentence);
          if (ref.tentative) {
            // It was judged as maybe asking nothing: the real question gets its own answer.
            store.setAutoAnswer(null);
            void inTurn(() => stopAutoAnswer(ref));
          } else {
            void inTurn(() => keepToContinue(ref));
          }
        }
      }
    }
    // Back from a layout switch or Settings: what is unanswered now can be
    // minutes old, so it stays a card to click rather than getting answered.
    if (justMountedRef.current && panelSeen) holdBackUnanswered();
    justMountedRef.current = false;
    setPanelSeen();
  }, [segments, addQuestion, autoTrigger, everyTurn]);

  const handleAssist = useCallback((index: number) => {
    const question = questions[index];
    if (!question) return;
    // Its automatic answer is on the way: a click doesn't restart it.
    const store = useQuestionStore.getState();
    if (autoAnswerRunning() && sameQuestion(store.autoAnswer?.question, question.text)) return;
    store.markAssisted(index);
    runYourAction("Assist", question.text).catch((err) => {
      // No answer came, so it stays a card to click.
      useQuestionStore.getState().holdBack(question.segmentId, question.text);
      showToast(String(err).includes(REFUSED) ? "Another answer is still running" : "Couldn't generate AI response", "error");
    });
  }, [questions]);

  const handleDismiss = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    useQuestionStore.getState().dismiss(index);
  }, []);

  const latest = questions.length > 0 ? questions[0] : null;
  const previousQuestions = questions.slice(1, 4);

  // Auto-Trigger: answer the newest question once the other party has been
  // quiet for a moment. More words from them restart the wait. Lines from a
  // provider that detects turns are answered on its signals instead.
  const waiting = autoTrigger && !!latest && !latest.assisted && !latest.heldBack
    && !useQuestionStore.getState().isTurnLine(latest.segmentId);
  const autoAssist = useCallback(() => {
    const q = useQuestionStore.getState().questions[0];
    if (!q || q.assisted || q.heldBack) return;
    useQuestionStore.getState().markAssisted(0);
    return startAutoAnswer(q, q.segmentId, false, "after the quiet wait");
  }, []);

  // A first draft while the question is still being asked: once its newest
  // words look like a question of DRAFT_MIN_WORDS words or more, once per
  // line. (Lines with turn signals are answered early on those instead.)
  const draftedLines = useRef(new Set<string>());
  const drafts = useAIActionsStore((s) => s.configs.globalDefaults.autoAnswerDraft ?? true);
  useEffect(() => {
    if (!autoTrigger || !drafts || !otherPartyActivity) return;
    const segs = useTranscriptStore.getState().segments;
    let seg: TranscriptSegment | undefined;
    for (let i = segs.length - 1; i >= 0 && !seg; i--) if (isOtherParty(segs[i].speaker)) seg = segs[i];
    if (!seg || draftedLines.current.has(seg.id)) return;
    const line = seg.id;
    const store = useQuestionStore.getState();
    if (store.isTurnLine(line) || store.autoAnswer?.segmentId === line) return;
    if (store.questions.some((q) => q.segmentId === line && q.assisted)) return;
    const question = whatToAnswer(seg.text, false);
    if (!question || isClosingQuestion(question) || question.split(/\s+/u).filter(Boolean).length < DRAFT_MIN_WORDS) return;
    draftedLines.current.add(line);
    void inTurn(() => startDraft(question, line));
  }, [otherPartyActivity, autoTrigger, drafts]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => void inTurn(autoAssist), quietWait(latest?.text ?? ""));
    return () => clearTimeout(timer);
  }, [waiting, latest?.text, otherPartyActivity, autoAssist]);

  return (
    <div className="flex flex-col gap-2.5" role="region" aria-label="Detected questions">
      {/* Latest question — prominent card */}
      <div
        className={`group flex items-start gap-3 rounded-lg transition-all duration-200 ${
          latest ? "cursor-pointer hover:bg-info/10 question-card-enter" : ""
        }`}
        onClick={() => latest && handleAssist(0)}
        onKeyDown={(e) => { if (latest && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleAssist(0); } }}
        role={latest ? "button" : undefined}
        tabIndex={latest ? 0 : undefined}
        aria-label={latest ? `Question: ${latest.text}. ${latest.assisted ? "Answered" : "Click to assist"}` : undefined}
      >
        <div className="relative mt-0.5 shrink-0" aria-hidden="true">
          <HelpCircle className={`h-5 w-5 transition-colors ${latest ? "text-info" : "text-muted-foreground/50"}`} />
          {latest && !latest.assisted && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-info animate-pulse" />
          )}
          {latest?.assisted && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-success">
              <Check className="h-2 w-2 text-white" />
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {latest ? (
            <p className="text-sm leading-relaxed font-medium text-foreground/90">
              &ldquo;{latest.text}&rdquo;
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/50">
              Listening for questions from the other party
            </p>
          )}
        </div>

        {latest && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleAssist(0); }}
              aria-label={latest.assisted ? "Already answered" : "Get AI assistance for this question"}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
                latest.assisted
                  ? "bg-success/10 border border-success/20 text-success"
                  : "bg-info/10 border border-info/20 text-info hover:bg-info/20"
              }`}
            >
              {latest.assisted ? (
                <><Check className="h-3.5 w-3.5" aria-hidden="true" />Answered</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Assist</>
              )}
            </button>
            <button
              onClick={(e) => handleDismiss(0, e)}
              aria-label="Dismiss question"
              className="rounded-lg p-1.5 text-muted-foreground/30 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Previous questions — compact list */}
      {previousQuestions.length > 0 && (
        <div className="flex flex-col gap-1">
          {previousQuestions.map((q, idx) => {
            const realIdx = idx + 1;
            return (
              <div
                key={`q-${realIdx}-${q.timestamp_ms}`}
                className={`group/q flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 question-card-enter ${
                  q.assisted
                    ? "bg-success/5 border border-success/10"
                    : "bg-card/20 hover:bg-card/40 hover:border-border/20 cursor-pointer"
                }`}
                onClick={() => !q.assisted && handleAssist(realIdx)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleAssist(realIdx); } }}
                title={q.text}
              >
                <div className="shrink-0">
                  {q.assisted ? (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-success/20">
                      <Check className="h-2.5 w-2.5 text-success" />
                    </div>
                  ) : (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted/30">
                      <Clock className="h-2.5 w-2.5 text-muted-foreground/60" />
                    </div>
                  )}
                </div>

                <span className={`flex-1 truncate text-xs leading-snug transition-colors ${
                  q.assisted
                    ? "text-success/70 font-medium"
                    : "text-muted-foreground/60 group-hover/q:text-foreground/80"
                }`}>
                  {q.text}
                </span>

                {!q.assisted && (
                  <Sparkles className="h-3 w-3 shrink-0 text-info/0 group-hover/q:text-info/60 transition-colors" />
                )}
                <button
                  onClick={(e) => handleDismiss(realIdx, e)}
                  aria-label="Dismiss question"
                  className="rounded p-0.5 text-muted-foreground/0 opacity-0 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive group-hover/q:opacity-100 group-hover/q:text-muted-foreground/30 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
