import { useEffect } from "react";
import { useStreamStore } from "../stores/streamStore";
import { useConfigStore } from "../stores/configStore";
import { logToFile } from "../lib/logger";
import { useQuestionStore } from "../stores/questionStore";
import { useStoryStore } from "../stores/storyStore";
import { findStory } from "../stores/storyMeaning";
import { EssentialReader, essentialSpeech } from "../lib/essentialSpeech";
import { withoutNotes } from "../lib/answerNotes";

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
  import("../lib/ipc")
    .then(({ systemCaptureExcludesSelf }) => systemCaptureExcludesSelf())
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
 * Reads the essentials of the answer aloud while it is written (see
 * essentialSpeech: the opening sentence and the gist of each point, not
 * every word), each as soon as it is finished. A new answer stops the old one.
 * A prepared story that matches the question is read at once instead, and the
 * AI's answer to that question isn't read over it.
 */
export function useLiveSpeech(): void {
  const enabled = useConfigStore((s) => s.speakAnswers ?? false);

  useEffect(() => {
    if (!enabled || typeof speechSynthesis === "undefined") return;
    // The voice list loads late in WebView2.
    speechSynthesis.getVoices();
    // Turning it on reads the answer on screen from the start, so you hear
    // at once that the voice reaches your headset; then what comes next.
    let lastContent = "";
    let spoken = 0;
    // What of the answer is worth hearing; a new one per answer.
    let reader = new EssentialReader();
    let voiceChecked = false;

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
      if (!voiceChecked) {
        voiceChecked = true;
        logToFile(
          voice ? "info" : "warn",
          "speech",
          voice
            ? `Voice: ${voice.name} (${voice.lang}), ${speechSynthesis.getVoices().length} installed`
            : `No ${lang} voice among ${speechSynthesis.getVoices().length} installed: the system default reads`,
        );
      }
      const finished = () => {
        if (!speechSynthesis.speaking && !speechSynthesis.pending) {
          speaking = false;
          speakingUntil = Date.now() + ECHO_TAIL_MS;
        }
      };
      utterance.onstart = () => { speaking = true; };
      utterance.onend = finished;
      utterance.onerror = (e) => {
        // "interrupted" / "canceled" are a new answer stopping the old one.
        if (e.error !== "interrupted" && e.error !== "canceled") {
          logToFile("warn", "speech", `The voice failed: ${e.error}`);
        }
        finished();
      };
      speaking = true;
      speechSynthesis.speak(utterance);
    };

    // The question whose prepared story is being read (its AI answer stays silent).
    let storyQuestion: string | null = null;
    let storyId: string | null = null;
    const onQuestion = async (question: string) => {
      if (!question || useQuestionStore.getState().paused) return;
      // By its words at once, else by meaning (a few tens of ms with Ollama).
      const story = await findStory(question, useStoryStore.getState().stories);
      if (question !== lastQuestion) return; // a newer question came meanwhile
      if (!story) {
        storyQuestion = null;
        return;
      }
      storyQuestion = question;
      if (story.id === storyId) return; // the same line grew: already being read
      storyId = story.id;
      stopSpeaking();
      say(essentialSpeech(story.answer));
      logToFile("info", "speech", "Reading a prepared story");
    };
    let lastQuestion = useQuestionStore.getState().questions[0]?.text ?? "";
    const unsubscribeQuestions = useQuestionStore.subscribe((s) => {
      const question = s.questions[0]?.text ?? "";
      if (question === lastQuestion) return;
      lastQuestion = question;
      void onQuestion(question);
    });

    const onChange = (state: ReturnType<typeof useStreamStore.getState>) => {
      // The notes are for your eyes: never read out.
      const content = withoutNotes(state.currentContent ?? "");
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
        reader = new EssentialReader();
      }
      lastContent = content;
      const done = !state.isStreaming && state.phase === "idle";
      const end = done ? content.length : lastSentenceEnd(content, spoken);
      if (end > spoken) {
        say(reader.take(content.slice(spoken, end)));
        spoken = end;
      }
    };

    const unsubscribe = useStreamStore.subscribe(onChange);
    logToFile("info", "speech", "Reading answers aloud");
    // The answer already on screen, now.
    onChange(useStreamStore.getState());
    return () => {
      unsubscribe();
      unsubscribeQuestions();
      stopSpeaking();
    };
  }, [enabled]);
}
