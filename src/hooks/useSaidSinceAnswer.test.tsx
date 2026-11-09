import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { covered } from "./useSaidSinceAnswer";
import { contentWords } from "../stores/storyStore";
import { AnswerMarkdown } from "../overlay/CueLine";

describe("what you already said", () => {
  const said = contentWords("alors chez Capgemini j'ai automatisé quarante processus de facturation");

  it("counts a point as said once most of its words were", () => {
    expect(covered("Chez Capgemini, j'ai automatisé 40 processus de facturation.", said)).toBe(true);
    expect(covered("Le résultat : moins 30 % de délais de paiement.", said)).toBe(false);
    expect(covered("Capgemini", said)).toBe(true);
    expect(covered("Capgemini", new Set())).toBe(false);
  });

  it("turns the keywords and list items said yellow, without striking them out", () => {
    render(
      <AnswerMarkdown
        content={"⚡ Capgemini · −30 % délais\n- Automatisé les processus de facturation chez Capgemini\n- Réduit les délais de paiement"}
        cueSize={14}
        said={said}
      />,
    );
    const keyword = screen.getByText("Capgemini");
    expect(keyword).toHaveAttribute("data-said", "1");
    expect(keyword.className).toContain("yellow");
    expect(screen.getByText("−30 % délais")).not.toHaveAttribute("data-said");
    const item = screen.getByText(/Automatisé les processus/).closest("li");
    expect(item).toHaveAttribute("data-said", "1");
    expect(item?.className).toContain("text-yellow-300");
    expect(screen.getByText(/Réduit les délais/).closest("li")).not.toHaveAttribute("data-said");
    expect(document.body.innerHTML).not.toContain("line-through");
  });
});

describe("what you said since the answer started", () => {
  it("collects your words (lines labelled User) from the start of the answer on", async () => {
    const { act, renderHook } = await import("@testing-library/react");
    const { useSaidSinceAnswer } = await import("./useSaidSinceAnswer");
    const { useTranscriptStore } = await import("../stores/transcriptStore");
    const { useStreamStore } = await import("../stores/streamStore");
    const line = (id: string, speaker: string, text: string) => ({ id, speaker, text, timestamp_ms: 0, is_final: true, confidence: 1 }) as never;

    useTranscriptStore.setState({ segments: [line("u0", "User", "bonjour Capgemini")] });
    const { result } = renderHook(() => useSaidSinceAnswer());
    act(() => { useStreamStore.setState({ requestStartedAt: 1 }); });
    act(() => {
      useTranscriptStore.setState({ segments: [line("u0", "User", "bonjour Capgemini"), line("t1", "Them", "facturation"), line("u1", "User", "j'ai automatisé la facturation")] });
    });
    expect(result.current.has("facturation")).toBe(true);
    expect(result.current.has("automatise")).toBe(true);
    // Said before the answer started, and the other party's words: not counted.
    expect(result.current.has("capgemini")).toBe(false);
  });
});
