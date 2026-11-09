import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Transcript event handlers the component subscribes, so a test can send lines.
const listeners = vi.hoisted(() => ({
  update: [] as Array<(e: { segment: unknown }) => void>,
  final: [] as Array<(e: { segment: unknown }) => void>,
}));
vi.mock("../lib/events", () => {
  const subscribe = (list: Array<(e: { segment: unknown }) => void>) => (h: (e: { segment: unknown }) => void) => {
    list.push(h);
    return Promise.resolve(() => { list.splice(list.indexOf(h), 1); });
  };
  return {
    onQuestionDetected: () => Promise.resolve(() => {}),
    onTranscriptUpdate: subscribe(listeners.update),
    onTranscriptFinal: subscribe(listeners.final),
  };
});
vi.mock("../lib/userAction", () => ({ runUserAction: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ipc")>()),
  cancelGeneration: vi.fn(() => Promise.resolve()),
}));

import { AUTO_TRIGGER_DELAY_MS, QUICK_TRIGGER_DELAY_MS, quietWait, QuestionDetector, QuestionPanel, lastSentence, looksLikeQuestion, whatToAnswer, isClosingQuestion, draftRequest, continuationRequest, unsureRequest, followOnRequest, FOLLOW_ON_MS } from "./QuestionDetector";
import { runUserAction } from "../lib/userAction";
import { cancelGeneration } from "../lib/ipc";
import { useStreamStore } from "../stores/streamStore";
import { useAIActionsStore } from "../stores/aiActionsStore";
import { useQuestionStore } from "../stores/questionStore";
import { useToastStore } from "../stores/toastStore";
import { resetMeetingScopedStores } from "../stores/resetMeeting";
import { useTranscriptStore } from "../stores/transcriptStore";
import type { GlobalDefaults, TranscriptSegment, TurnSignal } from "../lib/types";

const seg = (text: string, is_final = true): TranscriptSegment =>
  ({ id: "them_1", text, speaker: "Them", timestamp_ms: 1, is_final, confidence: 1 }) as TranscriptSegment;

function setDefaults(defaults: Partial<GlobalDefaults>) {
  const { configs } = useAIActionsStore.getState();
  useAIActionsStore.setState({ configs: { ...configs, globalDefaults: { ...configs.globalDefaults, ...defaults } } });
}

const setAutoTrigger = (on: boolean) => setDefaults({ autoTrigger: on });

// Most tests are about the answer to the finished question: no drafts there
// (the "draft" tests turn them on).
beforeEach(() => setDefaults({ autoAnswerDraft: false, autoAnswerUnsure: false }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(runUserAction).mockReset().mockImplementation(() => Promise.resolve());
  vi.mocked(cancelGeneration).mockClear();
  useQuestionStore.getState().clear();
  useStreamStore.getState().resetForMeeting();
  listeners.update.length = 0;
  listeners.final.length = 0;
});

/** A line from the other party carrying a provider turn signal. */
const turnLine = (text: string, turn: TurnSignal, id = "them_t1"): TranscriptSegment =>
  ({ id, text, speaker: "Them", timestamp_ms: 1, is_final: turn === "end", confidence: 1, turn }) as TranscriptSegment;

/** Delivers a line as the transcript events do (store first, as useTranscript does). */
function send(line: TranscriptSegment) {
  act(() => {
    if (line.is_final) useTranscriptStore.setState({ segments: [line] });
    for (const h of [...(line.is_final ? listeners.final : listeners.update)]) h({ segment: line });
  });
}

/** Lets queued Auto-Answer steps (and their stops) finish. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

/** Answers keep running until cancelled, like real streams. */
function answersRunUntilStopped() {
  const running = new Map<string, () => void>();
  vi.mocked(runUserAction).mockImplementation((_mode, _q, opts) => {
    const id = opts?.requestId ?? "?";
    useStreamStore.setState({ isStreaming: true, streamRequestId: id });
    return new Promise<void>((resolve) => running.set(id, resolve));
  });
  vi.mocked(cancelGeneration).mockImplementation(async (id) => {
    useStreamStore.setState({ isStreaming: false, streamRequestId: null });
    if (id) running.get(id)?.();
  });
}

const askedFor = () => vi.mocked(runUserAction).mock.calls.map((c) => c[1]);
const requestOf = (n: number) => vi.mocked(runUserAction).mock.calls[n][2]?.requestId;

describe("Auto-Answer with the provider's turn signals (Cartesia, Deepgram Flux)", () => {
  it("answers as soon as the provider says the speaker finished, with no quiet wait", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    render(<QuestionDetector />);
    send(turnLine("Thanks. What would you do first?", "end"));
    await settle();
    expect(askedFor()).toEqual(["What would you do first?"]);
    // The quiet wait doesn't answer it a second time.
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS * 3); });
    expect(runUserAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Answered")).toBeTruthy();
  });

  it("starts early on 'probably done' and keeps that answer when the turn ends the same", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    render(<QuestionDetector />);
    send(turnLine("What would you do first?", "eager_end"));
    await settle();
    expect(askedFor()).toEqual(["What would you do first?"]);
    send(turnLine("What would you do first?", "end"));
    await settle();
    expect(runUserAction).toHaveBeenCalledTimes(1);
    expect(cancelGeneration).not.toHaveBeenCalled();
  });

  it("stops the early answer when they keep talking, and answers the whole question at the end", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    answersRunUntilStopped();
    render(<QuestionDetector />);
    send(turnLine("What would you do", "eager_end"));
    await settle();
    const early = requestOf(0);
    send(turnLine("What would you do", "resumed"));
    await settle();
    expect(cancelGeneration).toHaveBeenCalledWith(early);
    expect(screen.queryByText("Answered")).toBeNull();

    send(turnLine("What would you do if the build broke?", "end"));
    await settle();
    expect(askedFor()).toEqual(["What would you do", "What would you do if the build broke?"]);
  });

  it("replaces the early answer when the turn ends with a different question", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    answersRunUntilStopped();
    render(<QuestionDetector />);
    send(turnLine("What would you do?", "eager_end"));
    await settle();
    send(turnLine("What would you do if the build broke?", "end"));
    await settle();
    expect(cancelGeneration).toHaveBeenCalledWith(requestOf(0));
    expect(askedFor()).toEqual(["What would you do?", "What would you do if the build broke?"]);
  });

  it("never stops an answer you asked for: the question waits as a card to click", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    useStreamStore.setState({ isStreaming: true, streamRequestId: "yours" });
    render(<QuestionDetector />);
    send(turnLine("What would you do first?", "end"));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS * 3); });
    expect(runUserAction).not.toHaveBeenCalled();
    expect(cancelGeneration).not.toHaveBeenCalled();
    expect(screen.getByText(/What would you do first\?/)).toBeTruthy();
    expect(screen.queryByText("Answered")).toBeNull();
  });

  it("clicking another question during an automatic answer stops it and answers yours", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    answersRunUntilStopped();
    useQuestionStore.getState().addQuestion(
      { text: "Which database did you pick?", confidence: 1, timestamp_ms: 1, source: "Them" }, "them_old");
    useQuestionStore.getState().markAssisted(0);
    useQuestionStore.getState().holdBack("them_old", "Which database did you pick?");
    render(<QuestionDetector />);
    send(turnLine("What would you do first?", "end"));
    await settle();
    const automatic = requestOf(0);

    fireEvent.click(screen.getByText(/Which database did you pick\?/));
    await settle();
    expect(cancelGeneration).toHaveBeenCalledWith(automatic);
    expect(askedFor()).toEqual(["What would you do first?", "Which database did you pick?"]);
    // The question it stopped goes back to a card to click.
    expect(useQuestionStore.getState().questions[0]).toMatchObject({ assisted: false, heldBack: true });
  });

  it("clicking the question being answered doesn't restart its answer", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    answersRunUntilStopped();
    render(<QuestionDetector />);
    send(turnLine("What would you do first?", "end"));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /Question: What would you do first\?/ }));
    await settle();
    expect(cancelGeneration).not.toHaveBeenCalled();
    expect(runUserAction).toHaveBeenCalledTimes(1);
  });

  it("a click that gets no answer stays a card to click, and says why", async () => {
    vi.useFakeTimers();
    setAutoTrigger(false);
    vi.mocked(runUserAction).mockRejectedValue("Generation already in progress");
    useQuestionStore.getState().addQuestion(
      { text: "What would you do first?", confidence: 1, timestamp_ms: 1, source: "Them" }, "them_1");
    render(<QuestionDetector />);

    fireEvent.click(screen.getByRole("button", { name: /Question: What would you do first\?/ }));
    await settle();
    expect(screen.queryByText("Answered")).toBeNull();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Another answer is still running");
  });

  it("answers nothing on turn signals with Auto-Answer off", async () => {
    vi.useFakeTimers();
    setAutoTrigger(false);
    render(<QuestionDetector />);
    send(turnLine("What would you do first?", "eager_end"));
    send(turnLine("What would you do first?", "end"));
    await settle();
    expect(runUserAction).not.toHaveBeenCalled();
  });
});

describe("Auto-Answer without turn signals (Deepgram Nova and the others)", () => {
  it("a refused automatic answer leaves the question to click, not marked answered", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    useStreamStore.setState({ isStreaming: true, streamRequestId: "yours" });
    useTranscriptStore.setState({ segments: [seg("What would you do first?")] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS * 3); });
    await settle();
    expect(runUserAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Answered")).toBeNull();
  });

  it("a line that grows into another question replaces the running automatic answer", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    answersRunUntilStopped();
    useTranscriptStore.setState({ segments: [seg("What would you do")] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS); });
    await settle();
    expect(askedFor()).toEqual(["What would you do"]);

    act(() => useTranscriptStore.setState({ segments: [seg("What would you do if the build broke?")] }));
    await settle();
    expect(cancelGeneration).toHaveBeenCalledWith(requestOf(0));
    await act(async () => { await vi.advanceTimersByTimeAsync(QUICK_TRIGGER_DELAY_MS - 1); });
    expect(runUserAction).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await settle();
    expect(askedFor()).toEqual(["What would you do", "What would you do if the build broke?"]);
  });
});

describe("Auto-Trigger", () => {
  it("waits less after a question mark, the full wait otherwise", () => {
    expect(quietWait("Comment tu as tranché ?")).toBe(QUICK_TRIGGER_DELAY_MS);
    expect(quietWait("Comment tu as tranché")).toBe(AUTO_TRIGGER_DELAY_MS);
  });

  it("answers a question once the other party has been quiet for a moment", () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    useTranscriptStore.setState({ segments: [seg("Thanks for joining. What would you do first?")] });
    render(<QuestionDetector />);
    // Closed with a question mark: the shorter wait.
    act(() => vi.advanceTimersByTime(QUICK_TRIGGER_DELAY_MS - 100));
    expect(runUserAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(runUserAction).toHaveBeenCalledWith("Assist", "What would you do first?", expect.anything());
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(runUserAction).toHaveBeenCalledTimes(1);
  });

  it("answers with the words to say when Auto-Answer is set to Say, French questions included", () => {
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true, autoAnswerMode: "WhatToSay" });
    useTranscriptStore.setState({ segments: [seg("Merci d'être là. Parlez-moi de votre dernier projet")] });
    render(<QuestionDetector />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS));
    expect(runUserAction).toHaveBeenCalledWith("WhatToSay", "Parlez-moi de votre dernier projet", expect.anything());
    setDefaults({ autoAnswerMode: "Assist" });
  });

  it("answers whenever they stop talking when set to, question or not", () => {
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true, autoAnswerTrigger: "turn" });
    useTranscriptStore.setState({ segments: [seg("Très bien. Je te laisse développer sur ton dernier projet")] });
    render(<QuestionDetector />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS));
    expect(runUserAction).toHaveBeenCalledWith("Assist", "Très bien. Je te laisse développer sur ton dernier projet", expect.anything());
    setDefaults({ autoAnswerTrigger: "questions" });
  });

  it("doesn't answer an evaluator's feedback or 'let me check', but answers the question after it", () => {
    for (const s of [
      "Très bonne réponse. Neuf sur dix, tu as une vraie approche d'architecte senior.",
      "Très bien, je te donne huit virgule cinq sur dix. Montre une vraie maturité.",
      "Merci, je regarde et je te fais un retour.",
      "D'accord, je vois merci, je synthétise ça et je reviens.",
      "C'est solide, je te mets 8/10 pour cette partie.",
    ]) {
      expect(whatToAnswer(s, true), s).toBeNull();
    }
    expect(whatToAnswer("Très bonne réponse, neuf sur dix. Question suivante, parle-moi de ton dernier échec", true))
      .toBe("Question suivante, parle-moi de ton dernier échec");
    expect(whatToAnswer("Je te laisse développer sur ton dernier projet en production", true)).not.toBeNull();
  });

  it("suggests questions to ask when they ask whether you have any", () => {
    for (const q of [
      "Est-ce que tu as des questions pour nous ?", "Avez-vous des questions", "Bon, on arrive à la fin, as-tu des questions de ton côté",
      "Do you have any questions for us?", "Des questions de votre côté ?",
    ]) {
      expect(isClosingQuestion(q), q).toBe(true);
    }
    for (const s of ["Je vais te poser des questions techniques", "Quelles questions te poses-tu sur l'architecture", "Tu as répondu à toutes les questions"]) {
      expect(isClosingQuestion(s), s).toBe(false);
    }
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true });
    useTranscriptStore.setState({ segments: [seg("Merci. Est-ce que tu as des questions pour nous ?")] });
    render(<QuestionDetector />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS));
    expect(runUserAction).toHaveBeenCalledWith("FollowUp", "Est-ce que tu as des questions pour nous ?", expect.anything());
  });

  it("answers a question announced then set out as a scenario", () => {
    expect(whatToAnswer("Passons à une question plus stratégique. Tu arrives sur un projet critique. La direction pousse pour livrer vite", false))
      .toBe("Passons à une question plus stratégique. Tu arrives sur un projet critique. La direction pousse pour livrer vite");
    expect(whatToAnswer("C'est une bonne réponse, je te donne huit sur dix. Merci.", false)).toBeNull();
  });

  it("leaves short acknowledgements and statements alone unless set to every turn", () => {
    expect(whatToAnswer("Oui, vas-y.", true)).toBeNull();
    expect(whatToAnswer("D'accord ?", true)).toBeNull();
    expect(whatToAnswer("Je te laisse développer sur ton dernier projet", false)).toBeNull();
    expect(whatToAnswer("A. B. C. D. Et voilà ce que je voulais dire aujourd'hui", true)).toBe("C. D. Et voilà ce que je voulais dire aujourd'hui");
  });

  it("waits while they keep talking, and answers the finished question", () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    useTranscriptStore.setState({ segments: [seg("What would you do")] });
    render(<QuestionDetector />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS - 500));
    act(() => useTranscriptStore.setState({ segments: [seg("What would you do if the build broke?", false)] }));
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS - 500));
    act(() => useTranscriptStore.setState({ segments: [seg("What would you do if the build broke?")] }));
    act(() => vi.advanceTimersByTime(QUICK_TRIGGER_DELAY_MS - 1));
    expect(runUserAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(runUserAction).toHaveBeenCalledWith("Assist", "What would you do if the build broke?", expect.anything());
  });

  it("only shows the question when turned off", () => {
    vi.useFakeTimers();
    setAutoTrigger(false);
    useTranscriptStore.setState({ segments: [seg("What would you do first?")] });
    render(<QuestionDetector />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(runUserAction).not.toHaveBeenCalled();
    expect(screen.getByText(/What would you do first\?/)).toBeTruthy();
  });
});

describe("QuestionPanel", () => {
  it("keeps detecting with Auto-Answer off, so the user picks what to answer", () => {
    vi.useFakeTimers();
    setDefaults({ questionDetection: true, autoTrigger: false });
    useTranscriptStore.setState({ segments: [seg("What would you do first?")] });
    render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(runUserAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Get AI assistance for this question" }));
    expect(runUserAction).toHaveBeenCalledWith("Assist", "What would you do first?");
  });

  it("shows nothing and answers nothing with detection off", () => {
    vi.useFakeTimers();
    setDefaults({ questionDetection: false, autoTrigger: true });
    useTranscriptStore.setState({ segments: [seg("What would you do first?")] });
    render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(screen.queryByText(/What would you do first\?/)).toBeNull();
    expect(runUserAction).not.toHaveBeenCalled();
    setDefaults({ questionDetection: true });
  });
});

describe("QuestionPanel coming back (layout switch, Settings)", () => {
  const question = "What would you do first?";

  it("doesn't answer an answered question again, and still shows it as answered", () => {
    vi.useFakeTimers();
    setDefaults({ questionDetection: true, autoTrigger: true });
    useTranscriptStore.setState({ segments: [seg(question)] });
    const { unmount } = render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS));
    expect(runUserAction).toHaveBeenCalledTimes(1);

    unmount();
    render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(runUserAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Already answered" })).toBeTruthy();
  });

  it("shows a question asked while away without answering it, then answers the next one", () => {
    vi.useFakeTimers();
    setDefaults({ questionDetection: true, autoTrigger: true });
    useTranscriptStore.setState({ segments: [] });
    const { unmount } = render(<QuestionPanel />);
    unmount();

    useTranscriptStore.setState({ segments: [seg(question)] });
    render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(screen.getByText(/What would you do first\?/)).toBeTruthy();
    expect(runUserAction).not.toHaveBeenCalled();

    act(() => useTranscriptStore.setState({
      segments: [seg(question), { ...seg("And how long would it take?"), id: "them_2" }],
    }));
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS));
    expect(runUserAction).toHaveBeenCalledWith("Assist", "And how long would it take?", expect.anything());
  });

  it("doesn't answer a question still waiting when the panel went away", () => {
    vi.useFakeTimers();
    setDefaults({ questionDetection: true, autoTrigger: true });
    useTranscriptStore.setState({ segments: [seg(question)] });
    const { unmount } = render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(QUICK_TRIGGER_DELAY_MS - 1));
    unmount();

    render(<QuestionPanel />);
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS * 3));
    expect(runUserAction).not.toHaveBeenCalled();
    expect(screen.getByText(/What would you do first\?/)).toBeTruthy();
  });

  it("keeps a dismissed question dismissed", () => {
    setDefaults({ questionDetection: true, autoTrigger: false });
    useTranscriptStore.setState({ segments: [seg(question)] });
    const { unmount } = render(<QuestionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss question" }));
    unmount();

    render(<QuestionPanel />);
    expect(screen.queryByText(/What would you do first\?/)).toBeNull();
  });

  it("starts empty in a new meeting, and answers its first question", async () => {
    setDefaults({ questionDetection: true, autoTrigger: true });
    useTranscriptStore.setState({ segments: [seg(question)] });
    const { unmount } = render(<QuestionPanel />);
    expect(screen.getByText(/What would you do first\?/)).toBeTruthy();
    unmount();

    await resetMeetingScopedStores();
    vi.useFakeTimers();
    render(<QuestionPanel />);
    expect(screen.queryByText(/What would you do first\?/)).toBeNull();

    // Same line id as the last meeting's: the new meeting's line is still checked.
    act(() => useTranscriptStore.setState({ segments: [seg(question)] }));
    act(() => vi.advanceTimersByTime(AUTO_TRIGGER_DELAY_MS));
    expect(runUserAction).toHaveBeenCalledWith("Assist", question, expect.anything());
  });
});

describe("QuestionDetector", () => {
  it("checks the newest sentence of a line", () => {
    expect(lastSentence("So here's the situation. What would you do?")).toBe("What would you do?");
    expect(looksLikeQuestion(lastSentence("We run preview days. How many do you run"))).toBe(true);
  });

  it("finds Chinese and Japanese questions", () => {
    expect(lastSentence("今天讨论进度。计划完成了吗？")).toBe("计划完成了吗？");
    expect(lastSentence("ありがとうございます。\n準備できましたか")).toBe("準備できましたか");
    for (const q of ["计划完成了？", "准备好了吗", "你的计划呢", "這個問題怎麼解決", "准备什么时候发布", "いつ始めますか。", "一緒に行きませんか"]) {
      expect(looksLikeQuestion(q), q).toBe(true);
    }
    for (const s of ["会议结束了。", "我们开始吧", "没什么问题", "无论如何都要按时完成", "会議は終了しました。", "とても静か", "コーヒーとか"]) {
      expect(looksLikeQuestion(s), s).toBe(false);
    }
  });

  it("finds French questions, which STT often writes without a question mark", () => {
    for (const q of [
      "Parlez-moi de votre dernier projet", "Pouvez-vous me décrire votre rôle",
      "Qu'est-ce qui vous motive", "Qu’est-ce que vous attendez de ce poste",
      "Comment gérez-vous les conflits", "Pourquoi voulez-vous nous rejoindre",
      "Quelle est votre plus grande faiblesse", "Quels sont vos objectifs.",
      "Avez-vous déjà travaillé avec UiPath", "Et vous, pensez-vous rester longtemps",
      "Est-ce que vous connaissez Python", "Donnez-moi un exemple concret",
      "Où vous voyez-vous dans cinq ans", "Combien de personnes avez-vous managé",
      "Vous avez combien d'années d'expérience ?", "Racontez-moi une situation difficile",
    ]) {
      expect(looksLikeQuestion(q), q).toBe(true);
    }
    for (const s of [
      "Quand j'étais chez Capgemini, j'ai mené ce projet.", "Quelle chance d'avoir cette équipe",
      "On a fixé un rendez-vous demain", "Merci beaucoup pour votre temps.", "Je travaille sur l'automatisation",
    ]) {
      expect(looksLikeQuestion(s), s).toBe(false);
    }
    for (const tag of ["D'accord ?", "Hein ?", "Voilà ?", "N'est-ce pas ?", "Bon, d'accord ?", "Tu vois ?", "C’est ça ?"]) {
      expect(looksLikeQuestion(tag), tag).toBe(false);
    }
  });

  it("finds spoken French questions after openers and with tu, from real interviews", () => {
    for (const q of [
      "Oui, deuxième question, comment tu t'assures que tes systèmes restent face aux pannes d'API",
      "Ok, et si tu partais quand même sur l'agent antique, quel garde-fou concret tu mettais pour limiter les dérives",
      "Alors, décris une fois où tu as dû choisir entre un workflow classique et une approche plus agentique",
      "Oui bien sûr, alors raconte-moi une situation où tu as dû reprendre une architecture existante",
      "Écoté explique explication au non tech ou conformité, comment tu l'as raconté pour que ça passe bien.",
      "Quelle décision tu as prise que tu as gardé",
      "Qu'est-ce que tu as appris et qu'est-ce que tu fais différemment",
      "Oui je reprends Question suivante, dans ton parcours sur des projets d'automatisation",
      "J'aimerais savoir pourquoi tu as quitté ton dernier poste",
      "Passons à une question plus stratégique. Tu arrives sur un projet critique avec six mois de retard",
      "Et pourquoi ce choix plutôt qu'un autre",
    ]) {
      expect(looksLikeQuestion(q), q).toBe(true);
    }
    for (const s of [
      "Très bonne réponse. Neuf sur dix, tu as une vraie approche d'architecte senior.",
      "Merci, j'évalue rapidement.",
      "Oui, donc tu disais quand le processus est déterministe, sensible ou réglementé, tu gardes le workflow classique.",
      "Tu expliques bien le contexte, l'échec et les leçons.",
      "Oui, je regarde ça. C'est une bonne réponse, je te donne huit sur dix.",
      "Je travaille sur un projet où l'on automatise la facturation",
      "Quelle estime pour cette équipe",
    ]) {
      expect(looksLikeQuestion(s), s).toBe(false);
    }
  });

  it("finds French questions whose asking word comes last, an acknowledgement glued after or not", () => {
    for (const q of [
      "Bien. Et si les tests montrent que le système tient, mais que les coûts dépassent le budget, tu fais quoi",
      "mais que les coûts dépassent le budget, tu fais quoi Oui,",
      "Et la dette technique, tu la gères comment",
      "Ce microservice, ça sert à quoi",
      "Le circuit breaker, c'est quoi",
      "Vous partiriez quand",
      "Et côté résultats mesurables, tu peux être plus précis",
      "Prends le temps de conclure avec un ou deux résultats chiffrés et",
      "D'accord. Tu as déjà géré une équipe à distance",
      "Précise les chiffres",
    ]) {
      expect(whatToAnswer(q, false), q).not.toBeNull();
    }
    for (const s of [
      "Je ne sais pas trop pourquoi",
      "Je t'explique comment",
      "Voilà comment",
      "On a fait un tableau de bord pour les coûts",
    ]) {
      expect(looksLikeQuestion(s), s).toBe(false);
    }
  });

  it("keeps a short request after the question with it", () => {
    expect(lastSentence("Comment tu gères les pannes d'API. Un exemple concret s'il te plaît.")).toBe(
      "Comment tu gères les pannes d'API. Un exemple concret s'il te plaît.",
    );
    expect(lastSentence("Je te donne huit sur dix. Merci beaucoup.")).toBe("Merci beaucoup.");
  });

  it("ignores a bare tag, which leaves nothing to answer", () => {
    for (const tag of ["Right?", "right", "Okay?", "Yeah, right?", "So, right?", "You know?", "Isn't it?", "Really?"]) {
      expect(looksLikeQuestion(tag), tag).toBe(false);
    }
    for (const q of ["Why?", "Is that right?", "Right now?", "And you?", "Can you start?"]) {
      expect(looksLikeQuestion(q), q).toBe(true);
    }
  });

  it("looks past a trailing tag for the question before it", () => {
    expect(lastSentence("Is that what you were thinking about? Right?")).toBe("Is that what you were thinking about?");
    expect(lastSentence("Can something change? Okay? Yeah, right?")).toBe("Can something change?");
    expect(lastSentence("Right?")).toBe("Right?");
  });

  it("finds a question a line gains after its first final", () => {
    useTranscriptStore.setState({ segments: [seg("So here's the situation.")] });
    render(<QuestionDetector />);
    expect(screen.queryByText(/What would you do/)).toBeNull();

    act(() => useTranscriptStore.setState({ segments: [seg("So here's the situation. What would you do?")] }));
    expect(screen.getByText(/What would you do\?/)).toBeTruthy();
  });
});

describe("a draft while the question is asked", () => {
  /** Each answer streams `text` into the stream store, as the backend would. */
  const answersWith = (...texts: string[]) => {
    let n = 0;
    vi.mocked(runUserAction).mockImplementation((mode, _q, opts) => {
      const id = opts?.requestId ?? crypto.randomUUID();
      const s = useStreamStore.getState();
      s.setPending(mode, id);
      s.startStream(mode as never, "m", "p", { requestId: id });
      s.appendToken(texts[n++] ?? "");
      s.endStream(5);
      return Promise.resolve();
    });
  };

  it("writes the opening as soon as the question is clear, then adds the rest after it", async () => {
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true, autoAnswerDraft: true });
    answersWith("J'ai mené la migration vers le cloud.", "Résultat : 30 % de coûts en moins.");
    const asked = "Parle-moi d'un projet que tu as mené";
    useTranscriptStore.setState({ segments: [seg(asked, false)] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // Still being asked: only its opening.
    expect(vi.mocked(runUserAction).mock.calls[0][1]).toBe(draftRequest(asked));

    const full = "Parle-moi d'un projet que tu as mené avec une équipe";
    act(() => useTranscriptStore.setState({ segments: [seg(full)] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    expect(runUserAction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runUserAction).mock.calls[1][1]).toBe(
      continuationRequest(full, "J'ai mené la migration vers le cloud."),
    );
    // The rest comes after the opening, and History keeps the whole as one answer.
    const stream = useStreamStore.getState();
    expect(stream.currentContent).toBe("J'ai mené la migration vers le cloud.\n\nRésultat : 30 % de coûts en moins.");
    expect(stream.responseHistory).toHaveLength(1);
  });

  it("goes on from the answer on screen when the question grows, instead of erasing it", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    answersWith("Je commencerais par lire les logs.", "Puis je reviendrais au dernier commit stable.");
    useTranscriptStore.setState({ segments: [seg("Que ferais-tu en premier")] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    expect(runUserAction).toHaveBeenCalledTimes(1);

    const full = "Que ferais-tu en premier si la mise en production cassait ?";
    act(() => useTranscriptStore.setState({ segments: [seg(full)] }));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(QUICK_TRIGGER_DELAY_MS + 10); });
    await settle();
    expect(runUserAction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runUserAction).mock.calls[1][1]).toBe(continuationRequest(full, "Je commencerais par lire les logs."));
    const stream = useStreamStore.getState();
    expect(stream.currentContent).toBe("Je commencerais par lire les logs.\n\nPuis je reviendrais au dernier commit stable.");
    expect(stream.responseHistory).toHaveLength(1);
  });

  it("doesn't draft a question of a few words", async () => {
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true, autoAnswerDraft: true });
    useTranscriptStore.setState({ segments: [seg("Parle-moi de toi", false)] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(runUserAction).not.toHaveBeenCalled();
  });
});

describe("a turn the rules don't see as a question", () => {
  /** Each answer streams `text` into the stream store, as the backend would. */
  const answersWith = (...texts: string[]) => {
    let n = 0;
    vi.mocked(runUserAction).mockImplementation((mode, _q, opts) => {
      const id = opts?.requestId ?? crypto.randomUUID();
      const s = useStreamStore.getState();
      s.setPending(mode, id);
      s.startStream(mode as never, "m", "p", { requestId: id });
      s.appendToken(texts[n++] ?? "");
      s.endStream(5);
      return Promise.resolve();
    });
  };

  it("right after an answer, goes on from it: nothing new keeps it, more is added after it", async () => {
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true, autoAnswerUnsure: true });
    answersWith("Je commencerais par les logs.", "∅", "Puis je donnerais deux chiffres.");
    useTranscriptStore.setState({ segments: [seg("Comment tu commencerais")] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    expect(useStreamStore.getState().currentContent).toBe("Je commencerais par les logs.");

    const feedback = "Nickel, c'est net, concret, orienté résultat, merci.";
    act(() => useTranscriptStore.setState({ segments: [seg("Comment tu commencerais"), { ...seg(feedback), id: "them_2" }] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    await settle();
    expect(vi.mocked(runUserAction).mock.calls[1][1]).toBe(followOnRequest(feedback, "Je commencerais par les logs."));
    // Nothing new: the answer stays as it was, and the line is no card to click.
    expect(useStreamStore.getState().currentContent).toBe("Je commencerais par les logs.");
    expect(useStreamStore.getState().responseHistory).toHaveLength(1);
    expect(useQuestionStore.getState().questions.some((q) => q.segmentId === "them_2")).toBe(false);

    const more = "Et avec des résultats chiffrés si possible";
    act(() => useTranscriptStore.setState({ segments: [...useTranscriptStore.getState().segments, { ...seg(more), id: "them_3" }] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    await settle();
    // Added after it, not rewritten.
    expect(useStreamStore.getState().currentContent).toBe("Je commencerais par les logs.\n\nPuis je donnerais deux chiffres.");
    expect(useStreamStore.getState().responseHistory).toHaveLength(1);
  });

  it("later on, is judged by the AI on its own: an answer only if something was asked", async () => {
    vi.useFakeTimers();
    setDefaults({ autoTrigger: true, autoAnswerUnsure: true });
    answersWith("Je commencerais par les logs.", "∅");
    useTranscriptStore.setState({ segments: [seg("Comment tu commencerais")] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(FOLLOW_ON_MS); });

    const feedback = "Nickel, c'est net, concret, orienté résultat, merci.";
    act(() => useTranscriptStore.setState({ segments: [seg("Comment tu commencerais"), { ...seg(feedback), id: "them_2" }] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS + 10); });
    await settle();
    expect(vi.mocked(runUserAction).mock.calls[1][1]).toBe(unsureRequest(feedback));
    expect(useStreamStore.getState().currentContent).toBe("Je commencerais par les logs.");
  });
});

describe("acknowledgements", () => {
  it("an answer on screen stays when \"oui\" or \"d'accord\" is glued to its question", async () => {
    vi.useFakeTimers();
    setAutoTrigger(true);
    useTranscriptStore.setState({ segments: [seg("Parle-moi d'un échec")] });
    render(<QuestionDetector />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS); });
    expect(runUserAction).toHaveBeenCalledTimes(1);
    act(() => useTranscriptStore.setState({ segments: [seg("Parle-moi d'un échec oui d'accord")] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_TRIGGER_DELAY_MS * 2); });
    expect(runUserAction).toHaveBeenCalledTimes(1);
    expect(cancelGeneration).not.toHaveBeenCalled();
  });

  it("\"Oui, d'accord, très bien\" is no turn to answer", () => {
    expect(whatToAnswer("Oui, d'accord, très bien, parfait", true)).toBeNull();
  });
});
