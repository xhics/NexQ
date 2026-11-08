import { useEffect, useRef } from "react";
import { AnswerMarkdown } from "./CueLine";
import { PreparedStory, usePreparedStory } from "./PreparedStory";
import { useSaidSinceAnswer } from "../hooks/useSaidSinceAnswer";
import { answerTimeColor, formatAnswerTime, useAnswerTimer } from "../hooks/useAnswerTimer";
import { Maximize2, Eye, Pause, Play, Headphones } from "lucide-react";
import { stopSpeaking } from "../hooks/useLiveSpeech";
import { useQuestionStore } from "../stores/questionStore";
import { useReadingScroll } from "../hooks/useReadingScroll";
import { useStreamStore } from "../stores/streamStore";
import { useConfigStore } from "../stores/configStore";

/** Compact box size, and the overlay's normal minimum to restore. */
export const COMPACT_SIZE = { width: 760, height: 130 };
const COMPACT_MIN = { width: 260, height: 56 };
const OVERLAY_MIN = { width: 400, height: 480 };
// Nearly invisible by default; never fully 0, so the box still takes clicks.
const OPACITY_PRESETS = [0.02, 0.08, 0.2, 0.4];
const SPEEDS = [6, 10, 14, 20, 30, 45];
const RATES = [1, 1.15, 1.3, 1.5, 1.75];

type Bounds = { x: number; y: number; width: number; height: number };
const BOUNDS_KEY = "nexq.compactBounds";

/** Where the box was last left, kept across restarts in this window's storage. */
function loadBounds(): Bounds | null {
  try {
    const b = JSON.parse(localStorage.getItem(BOUNDS_KEY) ?? "null") as Bounds | null;
    return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) ? b : null;
  } catch {
    return null;
  }
}
function saveBounds(b: Bounds): void {
  try { localStorage.setItem(BOUNDS_KEY, JSON.stringify(b)); } catch { /* storage unavailable */ }
}

/** The full overlay's place before the box, given back on the way out. */
let lastFull: Bounds | null = null;

async function currentBounds(): Promise<Bounds> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const pos = (await win.outerPosition()).toLogical(scale);
  const size = (await win.innerSize()).toLogical(scale);
  return { x: pos.x, y: pos.y, width: size.width, height: size.height };
}

/** Whether the box's saved top-left corner is still on a screen (one may have been unplugged). */
async function onScreen(b: Bounds): Promise<boolean> {
  const { availableMonitors } = await import("@tauri-apps/api/window");
  const monitors = await availableMonitors().catch(() => []);
  return monitors.some((m) => {
    const pos = m.position.toLogical(m.scaleFactor);
    const size = m.size.toLogical(m.scaleFactor);
    return b.x >= pos.x - 20 && b.y >= pos.y - 20 && b.x < pos.x + size.width - 40 && b.y < pos.y + size.height - 40;
  });
}

/** Remembers where the box is while it moves or resizes. */
export async function watchCompactBounds(): Promise<() => void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { currentBounds().then(saveBounds).catch(() => {}); }, 400);
  };
  const unlisten = await Promise.all([win.onMoved(save), win.onResized(save)]);
  return () => { clearTimeout(timer); unlisten.forEach((u) => u()); };
}

/** Shrinks the overlay window to the compact box: where you left it, else top centre. */
export async function enterCompactWindow(): Promise<void> {
  const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  lastFull = await currentBounds();
  await win.setMinSize(new LogicalSize(COMPACT_MIN.width, COMPACT_MIN.height));
  const saved = loadBounds();
  const target = saved && (await onScreen(saved)) ? saved : null;
  const width = target?.width ?? COMPACT_SIZE.width;
  await win.setSize(new LogicalSize(width, target?.height ?? COMPACT_SIZE.height));
  if (target) {
    await win.setPosition(new LogicalPosition(target.x, target.y));
    return;
  }
  const monitor = await currentMonitor();
  if (monitor) {
    const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
    const pos = area.position.toLogical(monitor.scaleFactor);
    const mon = area.size.toLogical(monitor.scaleFactor);
    await win.setPosition(new LogicalPosition(pos.x + (mon.width - width) / 2, pos.y + 8));
  }
}

/** Gives the overlay window its normal size and place back, remembering the box's. */
export async function leaveCompactWindow(): Promise<void> {
  const { getCurrentWindow, LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  saveBounds(await currentBounds());
  await win.setMinSize(new LogicalSize(OVERLAY_MIN.width, OVERLAY_MIN.height));
  const full = lastFull ?? { x: 50, y: 50, width: 500, height: 700 };
  await win.setSize(new LogicalSize(Math.max(full.width, OVERLAY_MIN.width), Math.max(full.height, OVERLAY_MIN.height)));
  if (lastFull) await win.setPosition(new LogicalPosition(full.x, full.y));
}

/**
 * The answer alone, in a nearly invisible framed box you can drag anywhere.
 * The rest of the overlay stays mounted underneath, so detection and
 * Auto-Answer go on.
 */
export function CompactAnswer({ onExit }: { onExit: () => void }) {
  const content = useStreamStore((s) => s.currentContent);
  const isStreaming = useStreamStore((s) => s.isStreaming);
  const phase = useStreamStore((s) => s.phase);
  const error = useStreamStore((s) => s.error);
  const fontSize = useConfigStore((s) => s.aiResponseFontSize ?? 12);
  const color = useConfigStore((s) => s.aiResponseTextColor ?? "#d4d4d8");
  const stored = useConfigStore((s) => s.compactOpacity ?? 0.02);
  const opacity = Math.max(stored, 0.02);
  const setOpacity = useConfigStore((s) => s.setCompactOpacity);
  const speed = useConfigStore((s) => s.readingSpeed ?? 14);
  const setSpeed = useConfigStore((s) => s.setReadingSpeed);
  const paused = useQuestionStore((s) => s.paused);
  const setPaused = useQuestionStore((s) => s.setPaused);
  const speakAnswers = useConfigStore((s) => s.speakAnswers ?? false);
  const setSpeakAnswers = useConfigStore((s) => s.setSpeakAnswers);
  const speechRate = useConfigStore((s) => s.speechRate ?? 1.15);
  const setSpeechRate = useConfigStore((s) => s.setSpeechRate);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the box's place across restarts, even if NexQ closes while it's open.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    watchCompactBounds().then((u) => { if (gone) u(); else stop = u; }).catch(() => {});
    return () => { gone = true; stop?.(); };
  }, []);

  // Starts at the top and moves at reading pace, not to the newest words.
  // A prepared story for the question shows first, at once.
  const prepared = usePreparedStory();
  const answerMs = useAnswerTimer();
  const said = useSaidSinceAnswer();
  const reading = useReadingScroll(scrollRef, content, prepared.story?.id ?? null, speed);

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging());
  };

  const cycleOpacity = () => {
    const idx = OPACITY_PRESETS.findIndex((p) => Math.abs(p - opacity) < 0.01);
    setOpacity(OPACITY_PRESETS[(idx + 1) % OPACITY_PRESETS.length]);
  };
  const changeSpeed = (step: 1 | -1) => {
    const idx = SPEEDS.findIndex((v) => v >= speed);
    const at = idx < 0 ? SPEEDS.length - 1 : idx;
    setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + step))]);
  };

  const waiting = (isStreaming || phase !== "idle") && !content;
  const btn = "rounded p-1 text-white/70 hover:bg-white/15 hover:text-white";

  return (
    <div
      className="group relative flex h-full cursor-move flex-col rounded-lg"
      style={{
        background: `hsl(var(--background) / ${opacity})`,
        border: "1px solid rgba(255, 255, 255, 0.4)",
        boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.35)",
      }}
      onMouseDown={startDrag}
      onDoubleClick={onExit}
      role="region"
      aria-label="Answer"
    >
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-black/50 px-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" onClick={() => { if (!paused) stopSpeaking(); setPaused(!paused); }} className={btn}
          title={paused ? "Resume Auto-Answer" : "Pause Auto-Answer"} aria-label={paused ? "Resume Auto-Answer" : "Pause Auto-Answer"}>
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
        </button>
        <button type="button" onClick={() => setSpeakAnswers(!speakAnswers)} className={`${btn} ${speakAnswers ? "text-primary" : ""}`}
          title={speakAnswers ? "Reading aloud — click to stop" : "Read answers aloud (in your headset)"} aria-label="Read answers aloud" aria-pressed={speakAnswers}>
          <Headphones className="h-3 w-3" />
        </button>
        {speakAnswers && (
          <button type="button" onClick={() => setSpeechRate(RATES[(RATES.indexOf(speechRate) + 1) % RATES.length])}
            className={`${btn} text-[9px] tabular-nums`} title="Voice speed (click to change)" aria-label="Voice speed">
            {speechRate.toFixed(2).replace(/0$/, "")}×
          </button>
        )}
        <button type="button" onClick={() => changeSpeed(-1)} className={`${btn} text-[10px] font-bold`} title="Scroll slower" aria-label="Scroll slower">−</button>
        <span className="text-[9px] tabular-nums text-white/60" title="Reading speed">{speed}</span>
        <button type="button" onClick={() => changeSpeed(1)} className={`${btn} text-[10px] font-bold`} title="Scroll faster" aria-label="Scroll faster">+</button>
        <button type="button" onClick={cycleOpacity} className={btn}
          title={`Background: ${Math.round(opacity * 100)}% (click to cycle)`} aria-label="Change background transparency">
          <Eye className="h-3 w-3" />
        </button>
        <button type="button" onClick={onExit} className={btn}
          title="Back to the full overlay (or double-click)" aria-label="Back to the full overlay">
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>

      {answerMs !== null && (
        <span
          className={`absolute bottom-1 right-2 z-10 text-[10px] font-semibold tabular-nums ${answerTimeColor(answerMs)}`}
          style={{ textShadow: "0 1px 2px #000" }}
          title="How long you have been answering"
          aria-label={`Answering for ${formatAnswerTime(answerMs)}`}
        >
          ⏱ {formatAnswerTime(answerMs)}
        </span>
      )}

      {paused && (
        <span className="absolute left-2 top-1 z-10 text-[9px] font-semibold uppercase tracking-wider text-amber-300/80" style={{ textShadow: "0 1px 2px #000" }}>
          Paused
        </span>
      )}

      <div ref={scrollRef} {...reading} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: "none" }} aria-live="polite">
        {prepared.story && (
          <div style={{ color, textShadow: "0 1px 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6)" }}>
            <PreparedStory story={prepared.story} fontSize={fontSize + 3} onHide={prepared.hide} said={said} />
          </div>
        )}
        {error ? (
          <p className="text-xs text-destructive/80">{error}</p>
        ) : content ? (
          <div
            className="prose prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0"
            style={{ fontSize: `${fontSize + 3}px`, color, lineHeight: 1.45, textShadow: "0 1px 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6)" }}
          >
            <AnswerMarkdown content={content} cueSize={fontSize + 6} said={said} />
            {isStreaming && <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-primary/60" />}
          </div>
        ) : (
          <p className="text-xs text-white/50" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
            {waiting ? "…" : paused ? "" : "Listening"}
          </p>
        )}
      </div>
    </div>
  );
}
