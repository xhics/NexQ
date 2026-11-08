import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

/** Where the box was last left, so leaving and re-entering keeps its place. */
let lastCompact: { x: number; y: number; width: number; height: number } | null = null;
let lastFull: { width: number; height: number } | null = null;

/** Shrinks the overlay window to the compact box: top centre the first time. */
export async function enterCompactWindow(): Promise<void> {
  const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const size = (await win.innerSize()).toLogical(scale);
  lastFull = { width: size.width, height: size.height };
  await win.setMinSize(new LogicalSize(COMPACT_MIN.width, COMPACT_MIN.height));
  const target = lastCompact ?? { x: NaN, y: NaN, ...COMPACT_SIZE };
  await win.setSize(new LogicalSize(target.width, target.height));
  if (lastCompact) {
    await win.setPosition(new LogicalPosition(lastCompact.x, lastCompact.y));
  } else {
    const monitor = await currentMonitor();
    if (monitor) {
      const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
      const pos = area.position.toLogical(monitor.scaleFactor);
      const mon = area.size.toLogical(monitor.scaleFactor);
      await win.setPosition(new LogicalPosition(pos.x + (mon.width - target.width) / 2, pos.y + 8));
    }
  }
}

/** Gives the overlay window its normal size back, remembering the box's place. */
export async function leaveCompactWindow(): Promise<void> {
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const pos = (await win.outerPosition()).toLogical(scale);
  const size = (await win.innerSize()).toLogical(scale);
  lastCompact = { x: pos.x, y: pos.y, width: size.width, height: size.height };
  await win.setMinSize(new LogicalSize(OVERLAY_MIN.width, OVERLAY_MIN.height));
  const full = lastFull ?? { width: 500, height: 700 };
  await win.setSize(new LogicalSize(Math.max(full.width, OVERLAY_MIN.width), Math.max(full.height, OVERLAY_MIN.height)));
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

  // Starts at the top and moves at reading pace, not to the newest words.
  const reading = useReadingScroll(scrollRef, content, null, speed);

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

      {paused && (
        <span className="absolute left-2 top-1 z-10 text-[9px] font-semibold uppercase tracking-wider text-amber-300/80" style={{ textShadow: "0 1px 2px #000" }}>
          Paused
        </span>
      )}

      <div ref={scrollRef} {...reading} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: "none" }} aria-live="polite">
        {error ? (
          <p className="text-xs text-destructive/80">{error}</p>
        ) : content ? (
          <div
            className="prose prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0"
            style={{ fontSize: `${fontSize + 3}px`, color, lineHeight: 1.45, textShadow: "0 1px 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6)" }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
