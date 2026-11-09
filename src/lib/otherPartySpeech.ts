// When the other party (the interviewer), and you, last said something: a new
// line, or a line growing. The answer's reading pace waits for them to be
// quiet before it starts moving, and doesn't move on its own while you speak
// (it follows what you have said then).

import { useTranscriptStore } from "../stores/transcriptStore";

/** They are done talking once quiet this long. */
export const OTHER_PARTY_QUIET_MS = 1500;

export const isOtherParty = (speaker: string) => speaker === "Them" || speaker === "Interviewer";

/** You are reading the answer out while you spoke this recently. */
export const YOU_SPEAKING_MS = 2500;

// Your lines are labelled "User" (the "You" party).
const isYou = (speaker: string) => speaker === "User";

let lastAt = 0;
let lastKey = "";
let youAt = 0;
let youKey = "";
let watching = false;

type Line = { id: string; speaker: string; text: string };

/** The newest line of a speaker, as "id:length" ("" when none). */
function newestKey(segments: ReadonlyArray<Line>, whose: (speaker: string) => boolean): string {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (whose(seg.speaker)) return `${seg.id}:${seg.text.length}`;
  }
  return "";
}

/** The newest line of the other party, as "id:length" ("" when none). */
export function otherPartyKey(segments: ReadonlyArray<Line>): string {
  return newestKey(segments, isOtherParty);
}

function watch(): void {
  if (watching) return;
  watching = true;
  const segments = useTranscriptStore.getState().segments;
  lastKey = otherPartyKey(segments);
  youKey = newestKey(segments, isYou);
  useTranscriptStore.subscribe((s) => {
    const key = otherPartyKey(s.segments);
    if (key !== lastKey) {
      lastKey = key;
      if (key) lastAt = Date.now();
    }
    const mine = newestKey(s.segments, isYou);
    if (mine !== youKey) {
      youKey = mine;
      if (mine) youAt = Date.now();
    }
  });
}

/** Whether the other party has been quiet for `quietMs` (or never spoke). */
export function otherPartyQuiet(now = Date.now(), quietMs = OTHER_PARTY_QUIET_MS): boolean {
  watch();
  return now - lastAt >= quietMs;
}

/** Whether you have been quiet for `quietMs` (not reading the answer out). */
export function youQuiet(now = Date.now(), quietMs = YOU_SPEAKING_MS): boolean {
  watch();
  return now - youAt >= quietMs;
}
