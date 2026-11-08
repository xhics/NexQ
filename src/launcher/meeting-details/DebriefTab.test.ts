import { describe, expect, it } from "vitest";
import { parseDebrief, transcriptText } from "./DebriefTab";

describe("interview debrief", () => {
  it("reads the AI's debrief, even fenced", () => {
    const items = parseDebrief('```json\n[{"question":"Parle-moi d\'un échec","answered":"Un projet RAG","feedback":"8/10","improve":["Chiffrer"],"better":"J\'ai…"},{"question":""}]\n```');
    expect(items).toEqual([{ question: "Parle-moi d'un échec", answered: "Un projet RAG", feedback: "8/10", improve: ["Chiffrer"], better: "J'ai…" }]);
    expect(() => parseDebrief("Pas de questions.")).toThrow();
  });

  it("writes the transcript with who is who", () => {
    const meeting = { transcript: [
      { speaker: "Them", text: "Parle-moi de toi" }, { speaker: "User", text: "Je suis architecte" }, { speaker: "User", text: " " },
    ] } as never;
    expect(transcriptText(meeting)).toBe("Them: Parle-moi de toi\nYou: Je suis architecte");
  });
});
