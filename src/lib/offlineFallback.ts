// When the online AI can't be reached (no Internet, provider down), an answer
// is retried on a local Ollama model, and later answers stay local for a
// minute before trying online again. Your saved provider is never changed.

import { listModels, setActiveModel, setLLMProvider } from "./ipc";
import { logToFile } from "./logger";
import { useConfigStore } from "../stores/configStore";
import { showToast } from "../stores/toastStore";

/** How long answers stay local before trying the online AI again. */
export const LOCAL_FOR_MS = 60_000;

let localUntil = 0;
let local = false;

/** A failure of the network or of the provider's servers, not of the request itself. */
export function isUnreachable(err: unknown): boolean {
  const text = String(err instanceof Error ? err.message : err);
  if (/already in progress|401|403|invalid api key|unauthori[sz]ed|quota|insufficient/i.test(text)) return false;
  return /error sending request|connect|timed? ?out|dns|network|offline|unreachable|ENOTFOUND|ECONNRE|\b50[234]\b|service unavailable|bad gateway/i.test(text);
}

/** A local model that can write answers (not an embedding model), if Ollama has one. */
export async function localChatModel(): Promise<string | null> {
  try {
    const models = await listModels("ollama");
    const chat = models.filter((m) => !/embed|bge|minilm/i.test(m.id));
    return chat[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function switchToLocal(model: string): Promise<void> {
  await setLLMProvider("ollama");
  await setActiveModel("ollama", model);
  local = true;
  localUntil = Date.now() + LOCAL_FOR_MS;
}

/** Back to the provider and model you chose, in the backend only. */
async function backOnline(): Promise<void> {
  const { llmProvider, llmModel } = useConfigStore.getState();
  local = false;
  await setLLMProvider(llmProvider);
  if (llmModel) await setActiveModel(llmProvider, llmModel);
  logToFile("info", "llm", "Trying the online AI again");
}

/**
 * Runs an answer; if the online AI can't be reached, runs it once more on a
 * local model. `retry` restarts the answer (with its pending state).
 */
export async function withOfflineFallback(run: () => Promise<void>, retry: () => Promise<void>): Promise<void> {
  if (local && Date.now() >= localUntil) await backOnline().catch(() => {});
  try {
    await run();
  } catch (err) {
    const provider = useConfigStore.getState().llmProvider;
    if (local || provider === "ollama" || !isUnreachable(err)) throw err;
    const model = await localChatModel();
    if (!model) throw err;
    logToFile("warn", "llm", `Online AI unreachable; answering with local model ${model}`);
    showToast(`Online AI unreachable: answering with ${model} on this PC`, "info");
    await switchToLocal(model);
    await retry();
  }
}
