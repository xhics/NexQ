import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }),
}));

import { lastSentenceEnd, speakableText, useLiveSpeech } from "./useLiveSpeech";
import { useConfigStore } from "../stores/configStore";
import { useStreamStore } from "../stores/streamStore";

describe("turning read-aloud on", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useConfigStore.setState({ speakAnswers: false });
  });

  it("reads the answer already on screen at once", () => {
    const spoken: string[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(t: string) { this.text = t; } });
    vi.stubGlobal("speechSynthesis", {
      speak: (u: { text: string }) => spoken.push(u.text),
      cancel: () => {},
      getVoices: () => [],
      speaking: false,
      pending: false,
    });
    useStreamStore.setState({ currentContent: "Bonjour, je suis prêt.", isStreaming: false, phase: "idle" });
    useConfigStore.setState({ speakAnswers: true });
    const { unmount } = renderHook(() => useLiveSpeech());
    expect(spoken).toEqual(["Bonjour, je suis prêt."]);
    unmount();
  });
});

describe("reading answers aloud", () => {
  it("reads each finished sentence, not a sentence still being written", () => {
    const text = "J'ai mené ce projet chez Capgemini. Nous avons automatisé 40 process";
    const end = lastSentenceEnd(text, 0);
    expect(text.slice(0, end)).toBe("J'ai mené ce projet chez Capgemini.");
    expect(lastSentenceEnd(text, end)).toBe(-1);
  });

  it("doesn't split numbers or versions", () => {
    expect(lastSentenceEnd("Le gain était de 3.5 jours par mois", 0)).toBe(-1);
    expect(lastSentenceEnd("On utilise UiPath v2.1 en production", 0)).toBe(-1);
  });

  it("reads a list item once its line is finished", () => {
    const text = "- Premier point\n- Second po";
    expect(text.slice(0, lastSentenceEnd(text, 0))).toBe("- Premier point\n");
  });

  it("speaks words, not markdown", () => {
    expect(speakableText("## Réponse\n- **Python** et `SQL`\n1. Voir [la doc](https://x.y)")).toBe(
      "Réponse Python et SQL Voir la doc",
    );
  });
});
