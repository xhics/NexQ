import { useEffect } from "react";
import { useStreamStore } from "../stores/streamStore";
import { useConfigStore } from "../stores/configStore";
import { logToFile } from "../lib/logger";
import { useQuestionStore } from "../stores/questionStore";
import { matchStory, useStoryStore } from "../stores/storyStore";

/**
 * After the voice stops, its echo can still be in the transcript this long:
 * the voice plays on the output NexQ also records for the other party.
 */
const ECHO_TAIL_MS = 1500;
let speakingUntil = 0;
let speaking = false;
/** The system capture leaves NexQ's sound out (Windows process loopback): no echo to guard against. */
let captureExcludesSelf = false;

function refreshCaptureExcludesSelf(): void {
  import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<boolean>("system_capture_excludes_self"))
    .then((v) => { captureExcludesSelf = v; })
    .catch(() => { captureExcludesSelf = false; });
}

/**
 * Whether NexQ's own voice is (or was just) playing and may be heard back as
 * the other party: never when the capture leaves NexQ's sound out.
 */
export function isSpeakingAnswer(): boolean {
  if (captureExcludesSelf) return false;
  return speaking || Date.now() < speakingUntil;
}

/** Stops the voice now. */
export function stopSpeaking(): void {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  speaking = false;
  speakingUntil = Date.now() + ECHO_TAIL_MS;
}

/** Markdown to plain words for the voice. */
export function speakableText(markdown: string): string {
  return markdown
    // The cue card's keywords are to glance at, not to hear.
    .replace(/^\s*⚡[^\n]*(?:\n|$)/gmu, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where the text read so far may end: after the last finished sentence or
 * line in `text` from `from` on, or -1 when none has finished yet. A full stop
 * counts only before a space or a new line, so "3.5" and "v2.1" aren't split.
 */
export function lastSentenceEnd(text: string, from: number): number {
  let end = -1;
  const re = /[.!?…:;](?=\s)|\n/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m; m = re.exec(text)) end = m.index + m[0].length;
  return end;
}

/**
 * Says `text` once (Practice mode asks its questions this way), whether or
 * not answers are read aloud. Resolves when it has been said, or at once
 * where the voice isn't available.
 */
export function speakOnce(text: string): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const { sttLanguage, speechRate } = useConfigStore.getState();
    const lang = sttLanguage && sttLanguage !== "auto" ? sttLanguage : navigator.language || "fr-FR";
    const utterance = new SpeechSynthesisUtterance(speakableText(text));
    utterance.lang = lang;
    utterance.rate = speechRate ?? 1.15;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.onend = utterance.onerror = () => {
      speaking = false;
      speakingUntil = Date.now() + ECHO_TAIL_MS;
      resolve();
    };
    speaking = true;
    speechSynthesis.speak(utterance);
  });
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const base = lang.slice(0, 2).toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  return (
    matching.find((v) => v.lang.toLowerCase() === lang.toLowerCase() && /natural|online/i.test(v.name))
    ?? matching.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    ?? matching[0]
  );
}

/**
 * Reads the answer aloud while it is written: each sentence as soon as it is
 * finished, not the whole answer at the end. A new answer stops the old one.
 * A prepared story that matches the question is read at once instead, and the
 * AI's answer to that question isn't read over it.
 */
export function useLiveSpeech(): void {
  const enabled = useConfigStore((s) => s.speakAnswers ?? false);

  useEffect(() => {
    if (!enabled || typeof speechSynthesis === "undefined") return;
    // The voice list loads late in WebView2.
    speechSynthesis.getVoices();
    // An answer already on screen isn't read back: only what comes next.
    let lastContent = useStreamStore.getState().currentContent ?? "";
    let spoken = lastContent.length;

    const say = (chunk: string) => {
      const words = speakableText(chunk);
      if (!/[\p{L}\p{N}]/u.test(words)) return;
      refreshCaptureExcludesSelf();
      const { sttLanguage, speechRate } = useConfigStore.getState();
      const lang = sttLanguage && sttLanguage !== "auto" ? sttLanguage : navigator.language || "fr-FR";
      const utterance = new SpeechSynthesisUtterance(words);
      utterance.lang = lang;
      utterance.rate = speechRate ?? 1.15;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.onstart = () => { speaking = true; };
      utterance.onend = utterance.onerror = () => {
        if (!speechSynthesis.speaking && !speechSynthesis.pending) {
          speaking = false;
          speakingUntil = Date.now() + ECHO_TAIL_MS;
        }
      };
      speaking = true;
      speechSynthesis.speak(utterance);
    };

    // The question whose prepared story is being read (its AI answer stays silent).
    let storyQuestion: string | null = null;
    let storyId: string | null = null;
    const onQuestion = (question: string) => {
      if (!question || useQuestionStore.getState().paused) return;
      const story = matchStory(question, useStoryStore.getState().stories);
      if (!story) {
        storyQuestion = null;
        return;
      }
      storyQuestion = question;
      if (story.id === storyId) return; // the same line grew: already being read
      storyId = story.id;
      stopSpeaking();
      say(story.answer);
      logToFile("info", "speech", "Reading a prepared story");
    };
    let lastQuestion = useQuestionStore.getState().questions[0]?.text ?? "";
    const unsubscribeQuestions = useQuestionStore.subscribe((s) => {
      const question = s.questions[0]?.text ?? "";
      if (question === lastQuestion) return;
      lastQuestion = question;
      onQuestion(question);
    });

    const onChange = (state: ReturnType<typeof useStreamStore.getState>) => {
      const content = state.currentContent ?? "";
      // The prepared story is read for this question: its AI answer isn't.
      if (storyQuestion !== null && storyQuestion === lastQuestion) {
        lastContent = content;
        spoken = content.length;
        return;
      }
      storyId = null;
      // A new answer (or the old one dropped): stop and start over.
      if (content.length < lastContent.length || !content.startsWith(lastContent.slice(0, 40))) {
        if (spoken > 0 || speaking) stopSpeaking();
        spoken = 0;
      }
      lastContent = content;
      const done = !state.isStreaming && state.phase === "idle";
      const end = done ? content.length : lastSentenceEnd(content, spoken);
      if (end > spoken) {
        say(content.slice(spoken, end));
        spoken = end;
      }
    };

    const unsubscribe = useStreamStore.subscribe(onChange);
    logToFile("info", "speech", "Reading answers aloud");
    return () => {
      unsubscribe();
      unsubscribeQuestions();
      stopSpeaking();
    };
  }, [enabled]);
}
