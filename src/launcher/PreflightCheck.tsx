import { useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  getRagStatus,
  listContextResources,
  testAudioDevice,
  testLLMConnection,
  testOllamaEmbeddingConnection,
  testSTTConnection,
} from "../lib/ipc";
import { useConfigStore } from "../stores/configStore";
import { useStoryStore } from "../stores/storyStore";

type Status = "pending" | "ok" | "fail" | "skip";
export interface CheckResult {
  label: string;
  status: Status;
  hint?: string;
}

const CHECK_TIMEOUT_MS = 10_000;

/** A check that fails after 10 s instead of hanging the list. */
async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer within 10 s")), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Everything a meeting needs, checked in parallel. */
export async function runPreflight(): Promise<CheckResult[]> {
  const config = useConfigStore.getState();
  const audio = config.meetingAudioConfig;
  const checks: Array<Promise<CheckResult>> = [];
  const check = (label: string, run: () => Promise<boolean | string>, hint: string) =>
    checks.push(
      within(run())
        .then((r): CheckResult => (r === true ? { label, status: "ok" } : { label, status: "fail", hint: typeof r === "string" ? r : hint }))
        .catch((e): CheckResult => ({ label, status: "fail", hint: `${hint} (${reason(e)})` })),
    );

  if (audio) {
    check("Your microphone", () => testAudioDevice(audio.you.device_id), "Pick your microphone in Settings > Audio & Devices");
    check("The other party's audio", () => testAudioDevice(audio.them.device_id), "Pick the output your meeting app plays on");
    const providers = [...new Set([audio.you.stt_provider, audio.them.stt_provider])];
    for (const provider of providers) {
      check(`Transcription (${provider})`, () => testSTTConnection(provider), "Check its API key in Settings > STT Providers");
    }
  } else {
    checks.push(Promise.resolve({ label: "Audio devices", status: "fail", hint: "Set up audio in Settings > Audio & Devices" }));
  }
  check(`AI (${config.llmProvider})`, () => testLLMConnection(config.llmProvider), "Check its API key and model in Settings > LLM Providers");
  check("Ollama (search in your documents)", async () => {
    const s = await testOllamaEmbeddingConnection();
    if (!s.connected) return "Ollama isn't running: start it, or answers use your documents unsearched";
    return s.models.some((m) => m.startsWith("nomic-embed-text")) || "Run: ollama pull nomic-embed-text";
  }, "Ollama isn't reachable");
  check("Your documents (CV)", async () => {
    const resources = await listContextResources();
    if (resources.length === 0) return "Add your CV in the Context panel";
    const rag = await getRagStatus();
    return rag.total_chunks > 0 || "Your CV isn't indexed yet: index it in the Context panel";
  }, "Couldn't read your documents");
  checks.push(
    useStoryStore.getState().load().then((): CheckResult => {
      const n = useStoryStore.getState().stories.length;
      return n > 0
        ? { label: `Prepared answers (${n})`, status: "ok" }
        : { label: "Prepared answers", status: "skip", hint: "Optional: write them in Settings > Prepared Answers" };
    }),
  );
  return Promise.all(checks);
}

const ICONS: Record<Status, JSX.Element> = {
  pending: <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />,
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  fail: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  skip: <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/60" />,
};

/** "Check everything" before an interview: devices, transcription, AI, documents. */
export function PreflightCheck() {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResults([{ label: "Checking…", status: "pending" }]);
    try {
      setResults(await runPreflight());
    } finally {
      setRunning(false);
    }
  };

  const failed = results?.filter((r) => r.status === "fail").length ?? 0;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/30 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-60"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        {running ? "Checking…" : results ? (failed ? `${failed} to fix — check again` : "All good — check again") : "Check everything"}
      </button>
      {results && !running && (
        <ul className="space-y-1 rounded-lg bg-secondary/10 px-3 py-2" aria-label="Checks">
          {results.map((r) => (
            <li key={r.label} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0">{ICONS[r.status]}</span>
              <span className="min-w-0">
                <span className="text-foreground/90">{r.label}</span>
                {r.hint && <span className="block text-[11px] text-muted-foreground/70">{r.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
