import { expect, it } from "vitest";
import { engineStatus } from "./CompactAnswer";

it("says what the engine does, and nothing while the answer is written", () => {
  expect(engineStatus(false, false, "idle")).toBe("listening");
  expect(engineStatus(false, false, "sending")).toBe("thinking");
  expect(engineStatus(false, true, "waiting")).toBe("thinking");
  expect(engineStatus(false, true, "thinking")).toBe("thinking");
  expect(engineStatus(false, true, "writing")).toBeNull();
  expect(engineStatus(true, false, "idle")).toBe("paused");
});
