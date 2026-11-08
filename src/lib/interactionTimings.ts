import type { LogEntry } from "./types";

/**
 * The waits saved with an AI interaction: until the AI's first words from its
 * start (`first_token_ms`) and from when you asked (`wait_ms`, document search
 * included). Left out when not measured.
 */
export function interactionTimings(e: Pick<LogEntry, "startedAt" | "requestedAt" | "firstTokenAt">): { first_token_ms?: number; wait_ms?: number } {
  if (e.firstTokenAt == null) return {};
  const out: { first_token_ms?: number; wait_ms?: number } = { first_token_ms: Math.max(0, e.firstTokenAt - e.startedAt) };
  if (e.requestedAt != null && e.requestedAt <= e.firstTokenAt) out.wait_ms = e.firstTokenAt - e.requestedAt;
  return out;
}
