import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  testAudioDevice: vi.fn(async (id: string) => id !== "broken"),
  testSTTConnection: vi.fn(async () => true),
  testLLMConnection: vi.fn(async () => { throw new Error("401 Unauthorized"); }),
  testOllamaEmbeddingConnection: vi.fn(async () => ({ connected: true, models: ["nomic-embed-text:latest"] })),
  listContextResources: vi.fn(async () => [{ id: "cv" }]),
  getRagStatus: vi.fn(async () => ({ total_chunks: 0 })),
}));
vi.mock("../stores/storyStore", () => ({
  useStoryStore: { getState: () => ({ load: async () => {}, stories: [] }) },
}));

import { runPreflight } from "./PreflightCheck";
import { useConfigStore } from "../stores/configStore";

describe("check everything", () => {
  it("says what works, what to fix and how", async () => {
    useConfigStore.setState({
      llmProvider: "openai",
      meetingAudioConfig: {
        you: { role: "You", device_id: "mic", is_input_device: true, stt_provider: "deepgram" },
        them: { role: "Them", device_id: "broken", is_input_device: false, stt_provider: "deepgram" },
        recording_enabled: false,
        preset_name: null,
      } as never,
    });
    const results = await runPreflight();
    const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));
    expect(byLabel["Your microphone"].status).toBe("ok");
    expect(byLabel["The other party's audio"].status).toBe("fail");
    expect(byLabel["Transcription (deepgram)"].status).toBe("ok");
    expect(byLabel["AI (openai)"]).toMatchObject({ status: "fail" });
    expect(byLabel["AI (openai)"].hint).toContain("401");
    expect(byLabel["Ollama (search in your documents)"].status).toBe("ok");
    expect(byLabel["Your documents (CV)"]).toMatchObject({ status: "fail", hint: expect.stringContaining("isn't indexed") });
    expect(byLabel["Prepared answers"].status).toBe("skip");
  });
});
