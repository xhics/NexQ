#!/usr/bin/env node
// Question detection on your own past meetings (read-only): which lines from
// the other party get an answer, and which don't.
//   npm run report:questions [-- path/to/nexq.db]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const fallback =
  platform() === "win32"
    ? join(process.env.APPDATA ?? "", "com.nexq.app", "nexq.db")
    : platform() === "darwin"
      ? join(homedir(), "Library", "Application Support", "com.nexq.app", "nexq.db")
      : join(homedir(), ".local", "share", "com.nexq.app", "nexq.db");
const db = process.argv[2] ?? fallback;
if (!existsSync(db)) {
  console.error(`No NexQ database at ${db}`);
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["vitest", "run", "src/overlay/questionReport.test.ts", "--reporter=dot", "--silent=false"],
  { stdio: "inherit", shell: true, env: { ...process.env, NEXQ_QUESTION_REPORT: db, NODE_NO_WARNINGS: "1" } },
);
process.exit(result.status ?? 1);
