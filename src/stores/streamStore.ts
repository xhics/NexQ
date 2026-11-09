import { create } from "zustand";
import type { AIResponse, IntelligenceMode, StreamSource } from "../lib/types";
import { stripThinkTags } from "../lib/utils";
import { NO_USER_REQUESTS, type LastUserRequests } from "../lib/contextScope";

/** Every answer of the meeting is kept, up to this many (newest first). */
export const RESPONSE_HISTORY_CAP = 100;

/**
 * Where the current request is:
 * - `sending`: the user acted, no `llm_stream_start` yet
 * - `waiting`: started, no tokens yet
 * - `thinking`: the model is reasoning (backend thinking event, or <think> tokens)
 * - `writing`: visible words are arriving
 * - `idle`: nothing in flight
 */
export type StreamPhase = "idle" | "sending" | "waiting" | "thinking" | "writing";

/** What the start event told us about the current request. */
export interface StreamMeta {
  model: string;
  provider: string;
  /** The user's transcript scope ("Last 5 min"), null for the action default. */
  scopeLabel: string | null;
  /** Transcript lines sent: new lines on the Claude session path, lines in the window otherwise. */
  newLines: number | null;
  /** The Claude session that answers; null on the stateless path. */
  sessionKey: string | null;
}

/** Optional start-event details for `startStream`. */
export interface StreamStartDetails extends Partial<Omit<StreamMeta, "model" | "provider">> {
  requestId?: string | null;
}

interface StreamState {
  // Current stream
  isStreaming: boolean;
  currentContent: string;
  _rawContent: string; // unfiltered content (includes <think> tags)
  currentMode: IntelligenceMode | null;
  currentModel: string;
  currentProvider: string;
  currentSources: StreamSource[];
  error: string | null;
  latencyMs: number | null;

  // Progress of the current request
  phase: StreamPhase;
  /** Epoch ms the user acted (or the stream started, when not user-invoked). */
  requestStartedAt: number | null;
  /**
   * Epoch ms the answer on screen began: a continuation (the rest of an
   * answer started early) keeps its start, so what you said stays marked.
   */
  answerSince: number | null;
  /** Epoch ms the first visible words arrived. */
  firstTokenAt: number | null;
  streamMeta: StreamMeta | null;
  /** Request id of the user action awaiting its start event. */
  pendingRequestId: string | null;
  /** Request id of the answer streaming now (null when idle or unknown). */
  streamRequestId: string | null;

  /** Id of the history entry shown as "Current" (null while streaming / none). */
  currentId: string | null;
  /** Every answer of the meeting (newest first, capped) + pinned responses. */
  responseHistory: AIResponse[];
  pinnedResponses: AIResponse[];

  /** Start times of the previous user requests in this meeting (for "since last …" scopes). */
  lastUserRequest: LastUserRequests;

  // Actions
  setStreaming: (streaming: boolean) => void;
  appendToken: (token: string) => void;
  /** A user action was invoked: show "Sending…" until its start event. No-op while streaming. */
  setPending: (mode: IntelligenceMode | string, requestId: string) => void;
  /** The pending action failed before starting (only clears that request). */
  clearPending: (requestId: string) => void;
  /** Whether `requestId` is the request being sent or streamed now. */
  isRunning: (requestId: string) => boolean;
  /** When `requestId` ends, drop it: not kept in History, not left on screen. */
  discardRequest: (requestId: string) => void;
  /**
   * `requestId` continues the answer on screen: its words are added after
   * it, and the whole replaces it in History.
   */
  markContinuation: (requestId: string) => void;
  /**
   * `requestId` may find nothing was asked: the answer on screen stays until
   * its first words, and for good if it answers NOTHING_MARK.
   */
  markTentative: (requestId: string) => void;
  setPhase: (phase: StreamPhase) => void;
  startStream: (mode: IntelligenceMode, model: string, provider: string, details?: StreamStartDetails) => void;
  setSources: (sources: StreamSource[]) => void;
  endStream: (latencyMs: number) => void;
  setError: (error: string | null) => void;
  clearCurrent: () => void;
  pinResponse: (id: string) => void;
  unpinResponse: (id: string) => void;
  recordUserRequest: (mode: string, at: number) => void;
  /** Meeting start: forget the previous meeting's answers, pins and request times. */
  resetForMeeting: () => void;
}

const IDLE_PROGRESS = {
  phase: "idle" as StreamPhase,
  requestStartedAt: null,
  firstTokenAt: null,
  streamMeta: null,
  pendingRequestId: null,
  streamRequestId: null,
};

/** Requests to drop when they end (automatic answers NexQ stopped). */
const discarded = new Set<string>();

/**
 * Requests that continue an answer (its text, and its History entry to
 * replace), or, `tentative`, that may answer nothing: the answer on screen
 * stays until their first words, and stays for good if they answer NOTHING_MARK.
 */
type Continuation = { prefix: string; replaces: string | null; tentative?: boolean };
const continuations = new Map<string, Continuation>();

/** What a continuation's own words go after (a tentative answer's own words replace the answer). */
const continued = (cont: Continuation) => (!cont.tentative && cont.prefix.trim() ? `${cont.prefix.trimEnd()}\n\n` : "");

/** What an answer that finds it was asked nothing replies, alone. */
export const NOTHING_MARK = "∅";

/** Tentative requests that answered NOTHING_MARK (cleared when asked about). */
const answeredNothingIds = new Set<string>();

/** Whether `requestId` was a tentative answer that found nothing was asked. Asks once. */
export function answeredNothing(requestId: string): boolean {
  return answeredNothingIds.delete(requestId);
}

/**
 * A continuation that starts with this line found the answer's start had
 * misread the question: what follows replaces the whole answer.
 */
export const REDO_MARK = "↻";

/**
 * What shows of `raw` (think tags left out). For a continuation whose own
 * words start with REDO_MARK, only what follows it: the start goes.
 */
function visible(raw: string, requestId: string | null): { content: string; redone: boolean; held: boolean } {
  const cont = requestId !== null ? continuations.get(requestId) : undefined;
  if (cont?.tentative) {
    // Until its first words, and for good if it answers nothing, the answer on screen stays.
    const own = stripThinkTags(raw).trimStart();
    const held = own === "" || own.startsWith(NOTHING_MARK);
    return { content: held ? cont.prefix : stripThinkTags(raw), redone: false, held };
  }
  if (cont) {
    const start = continued(cont);
    const own = stripThinkTags(raw.slice(start.length)).trimStart();
    // Nothing to add: the answer stays as it was.
    if (raw.startsWith(start) && own.startsWith(NOTHING_MARK)) return { content: cont.prefix, redone: false, held: true };
    if (raw.startsWith(start) && own.startsWith(REDO_MARK)) {
      return { content: own.slice(REDO_MARK.length).trimStart(), redone: true, held: false };
    }
  }
  return { content: stripThinkTags(raw), redone: false, held: false };
}

export const useStreamStore = create<StreamState>((set, get) => ({
  isStreaming: false,
  currentContent: "",
  _rawContent: "",
  currentMode: null,
  currentModel: "",
  currentProvider: "",
  currentSources: [],
  error: null,
  latencyMs: null,
  ...IDLE_PROGRESS,
  currentId: null,
  responseHistory: [],
  pinnedResponses: [],
  lastUserRequest: NO_USER_REQUESTS,
  answerSince: null,

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  appendToken: (token) =>
    set((state) => {
      const raw = state._rawContent + token;
      const { content, redone, held } = visible(raw, state.streamRequestId);
      const before = visible(state._rawContent, state.streamRequestId);
      const progress: Partial<StreamState> = {};
      // Started over, or a tentative answer's first words: a new answer, what
      // you said of the one before no longer counts.
      if ((redone && !before.redone) || (!held && before.held)) progress.answerSince = Date.now();
      if (held) {
        // Nothing of its own shows yet.
        if (state.firstTokenAt === null && raw.trim().length > 0) progress.phase = "thinking";
      } else if (state.firstTokenAt === null && content.trim().length > 0) {
        progress.firstTokenAt = Date.now();
        progress.phase = "writing";
      } else if (state.firstTokenAt === null && raw.trim().length > 0) {
        // Only <think> content so far.
        progress.phase = "thinking";
      }
      return { _rawContent: raw, currentContent: content, ...progress };
    }),

  setPending: (mode, requestId) => {
    // A second press while one is running or still sending is refused by the
    // backend; it must not take over the first request's progress.
    if (get().isStreaming || get().phase === "sending") return;
    const cont = continuations.get(requestId);
    const now = Date.now();
    set({
      phase: "sending",
      pendingRequestId: requestId,
      requestStartedAt: now,
      answerSince: cont ? get().answerSince ?? now : now,
      firstTokenAt: null,
      streamMeta: null,
      currentMode: mode as IntelligenceMode,
      // A continuation keeps the answer's start on screen; a tentative
      // answer, the answer before it.
      currentContent: cont ? cont.prefix : "",
      _rawContent: cont && !cont.tentative ? cont.prefix : "",
      currentSources: [],
      currentId: cont?.tentative ? cont.replaces : null,
      error: null,
    });
  },

  clearPending: (requestId) => {
    if (get().pendingRequestId !== requestId) return;
    // A continuation stopped before its first word: the answer it was to
    // continue stays on screen, as it was.
    const cont = continuations.get(requestId);
    continuations.delete(requestId);
    set({
      ...IDLE_PROGRESS,
      currentMode: get().isStreaming || cont ? get().currentMode : null,
      ...(cont ? { currentContent: cont.prefix, _rawContent: cont.prefix, currentId: cont.replaces } : {}),
    });
  },

  isRunning: (requestId) => {
    const state = get();
    return state.pendingRequestId === requestId || (state.isStreaming && state.streamRequestId === requestId);
  },

  discardRequest: (requestId) => {
    discarded.add(requestId);
  },

  markContinuation: (requestId) => {
    const state = get();
    continuations.set(requestId, { prefix: state.currentContent, replaces: state.currentId });
  },

  markTentative: (requestId) => {
    const state = get();
    continuations.set(requestId, { prefix: state.currentContent, replaces: state.currentId, tentative: true });
  },

  setPhase: (phase) => set({ phase }),

  startStream: (mode, model, provider, details = {}) => {
    const state = get();
    const fromClick =
      state.pendingRequestId !== null &&
      state.requestStartedAt !== null &&
      (details.requestId == null || details.requestId === state.pendingRequestId);
    const cont = details.requestId ? continuations.get(details.requestId) : undefined;
    const start = cont ? continued(cont) : "";
    set({
      isStreaming: true,
      currentContent: cont?.tentative ? cont.prefix : start,
      _rawContent: start,
      answerSince: cont || fromClick ? state.answerSince ?? Date.now() : Date.now(),
      currentMode: mode,
      currentModel: model,
      currentProvider: provider,
      currentSources: [],
      error: null,
      latencyMs: null,
      phase: "waiting",
      requestStartedAt: fromClick ? state.requestStartedAt : Date.now(),
      firstTokenAt: null,
      pendingRequestId: null,
      streamRequestId: details.requestId ?? null,
      currentId: cont?.tentative ? cont.replaces : null,
      streamMeta: {
        model,
        provider,
        scopeLabel: details.scopeLabel ?? null,
        newLines: details.newLines ?? null,
        sessionKey: details.sessionKey ?? null,
      },
    });
  },

  setSources: (sources) => set({ currentSources: sources }),

  endStream: (latencyMs) => {
    const state = get();
    // Strip <think> tags from the final stored content
    const { content, held } = visible(state._rawContent, state.streamRequestId);
    const now = Date.now();
    const started = state.requestStartedAt;
    const response: AIResponse = {
      id: crypto.randomUUID(),
      content,
      mode: state.currentMode!,
      timestamp: now,
      pinned: false,
      model: state.currentModel,
      provider: state.currentProvider,
      latency_ms: latencyMs,
      sources: state.currentSources.length > 0 ? state.currentSources : undefined,
      total_ms: started !== null ? now - started : latencyMs,
      first_token_ms: started !== null && state.firstTokenAt !== null ? state.firstTokenAt - started : undefined,
      scope_label: state.streamMeta?.scopeLabel ?? null,
    };
    // A stream stopped before any words is nothing to keep, nor is one NexQ
    // stopped and asked to drop.
    const cont = state.streamRequestId !== null ? continuations.get(state.streamRequestId) : undefined;
    // A tentative answer that found nothing was asked leaves the one before as it was.
    if (cont && held && state.streamRequestId !== null) answeredNothingIds.add(state.streamRequestId);
    const dropped = state.streamRequestId !== null && (discarded.delete(state.streamRequestId) || (!!cont && held));
    const keep = !dropped && content.trim().length > 0;
    // A continuation replaces the answer it continued in History; dropped,
    // it leaves that answer on screen as it was. A tentative answer is a new one.
    if (state.streamRequestId !== null) continuations.delete(state.streamRequestId);
    const replaced = keep && cont?.replaces && !cont.tentative ? cont.replaces : null;

    set((s) => ({
      isStreaming: false,
      currentContent: dropped ? cont?.prefix ?? "" : content,
      latencyMs,
      ...IDLE_PROGRESS,
      currentId: keep ? response.id : dropped ? cont?.replaces ?? null : null,
      responseHistory: keep
        ? [response, ...s.responseHistory.filter((r) => r.id !== replaced)].slice(0, RESPONSE_HISTORY_CAP)
        : s.responseHistory,
    }));
  },

  setError: (error) => set({ error, isStreaming: false, ...IDLE_PROGRESS }),
  clearCurrent: () =>
    set({
      currentContent: "",
      _rawContent: "",
      currentMode: null,
      currentModel: "",
      currentProvider: "",
      currentSources: [],
      error: null,
      latencyMs: null,
      currentId: null,
      ...IDLE_PROGRESS,
    }),

  pinResponse: (id) => {
    const state = get();
    const response = state.responseHistory.find((r) => r.id === id);
    if (response && !state.pinnedResponses.find((r) => r.id === id)) {
      set({
        pinnedResponses: [
          ...state.pinnedResponses,
          { ...response, pinned: true },
        ],
      });
    }
  },

  unpinResponse: (id) =>
    set((state) => ({
      pinnedResponses: state.pinnedResponses.filter((r) => r.id !== id),
    })),

  recordUserRequest: (mode, at) =>
    set((state) => ({
      lastUserRequest: {
        anyAt: at,
        byMode: { ...state.lastUserRequest.byMode, [mode]: at },
      },
    })),

  resetForMeeting: () => {
    discarded.clear();
    continuations.clear();
    answeredNothingIds.clear();
    get().clearCurrent();
    set({ isStreaming: false, responseHistory: [], pinnedResponses: [], lastUserRequest: NO_USER_REQUESTS });
  },
}));
