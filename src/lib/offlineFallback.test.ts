import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  listModels: vi.fn(async () => [{ id: "nomic-embed-text:latest" }, { id: "qwen2.5:3b" }]),
  setLLMProvider: vi.fn(async () => {}),
  setActiveModel: vi.fn(async () => {}),
}));
vi.mock("./logger", () => ({ logToFile: vi.fn() }));

import { isUnreachable, localChatModel, withOfflineFallback } from "./offlineFallback";
import { setActiveModel, setLLMProvider } from "./ipc";
import { useConfigStore } from "../stores/configStore";

beforeEach(() => {
  vi.mocked(setLLMProvider).mockClear();
  vi.mocked(setActiveModel).mockClear();
  useConfigStore.setState({ llmProvider: "openai", llmModel: "gpt-5.4-mini" } as never);
});

describe("answering without Internet", () => {
  it("tells an unreachable AI from a request it refused", () => {
    expect(isUnreachable("error sending request for url (https://api.openai.com/v1/chat/completions)")).toBe(true);
    expect(isUnreachable(new Error("operation timed out"))).toBe(true);
    expect(isUnreachable("HTTP 503 Service Unavailable")).toBe(true);
    expect(isUnreachable("HTTP 401 invalid api key")).toBe(false);
    expect(isUnreachable("Generation already in progress")).toBe(false);
  });

  it("picks a local model that writes, not the embedding one", async () => {
    expect(await localChatModel()).toBe("qwen2.5:3b");
  });

  it("retries on the local model when the online AI is unreachable, then goes back online later", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => { throw new Error("error sending request"); });
    const retry = vi.fn(async () => {});
    await withOfflineFallback(run, retry);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(setLLMProvider).toHaveBeenLastCalledWith("ollama");
    expect(setActiveModel).toHaveBeenLastCalledWith("ollama", "qwen2.5:3b");

    // A minute on, the next answer tries the online AI again.
    vi.advanceTimersByTime(61_000);
    await withOfflineFallback(async () => {}, retry);
    expect(setLLMProvider).toHaveBeenLastCalledWith("openai");
    expect(setActiveModel).toHaveBeenLastCalledWith("openai", "gpt-5.4-mini");
    vi.useRealTimers();
  });

  it("doesn't retry a refused request", async () => {
    const retry = vi.fn(async () => {});
    await expect(withOfflineFallback(async () => { throw new Error("HTTP 401"); }, retry)).rejects.toThrow("401");
    expect(retry).not.toHaveBeenCalled();
  });
});
