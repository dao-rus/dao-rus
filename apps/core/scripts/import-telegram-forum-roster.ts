import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import {
  applyTelegramForumRosterImport,
  previewTelegramForumRosterImport,
} from "../src/lib/telegram-forum-roster-import";
import { TelegramParticipantIdentityConflictError } from "../src/lib/telegram-participant";
import { TelegramRosterIntegrityError, TelegramRosterValidationError } from "../src/lib/telegram-roster";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 ||
      (args.length === 2 && args[1] !== "--dry-run" && args[1] !== "--apply")) {
    throw new Error("Usage: npm run telegram:forum:import -- <snapshot.json> [--dry-run|--apply]");
  }
  const forumChatId = process.env.TELEGRAM_FORUM_CHAT_ID?.trim();
  if (!forumChatId) throw new Error("TELEGRAM_FORUM_CHAT_ID is required");
  const source = await fs.readFile(path.resolve(args[0]), "utf8");
  const digest = createHash("sha256").update(source).digest("hex");
  let snapshot: unknown;
  try { snapshot = JSON.parse(source); }
  catch { throw new Error("Invalid JSON snapshot"); }

  const { pool } = await import("../src/lib/db");
  try {
    if (args[1] === "--apply") {
      const result = await applyTelegramForumRosterImport(pool, snapshot, forumChatId);
      console.log(JSON.stringify({ mode: "apply", snapshotSha256: digest, ...result }));
    } else {
      const result = await previewTelegramForumRosterImport(pool, snapshot, forumChatId);
      console.log(JSON.stringify({ mode: "dry-run", snapshotSha256: digest, ...result }));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  if (error instanceof TelegramParticipantIdentityConflictError ||
      error instanceof TelegramRosterIntegrityError) {
    console.error("Forum identity conflict; import was not applied");
  } else if (error instanceof TelegramRosterValidationError) {
    console.error("Invalid forum roster snapshot; import was not applied");
  } else {
    console.error(error instanceof Error ? error.message : "Forum roster import failed");
  }
  process.exitCode = 1;
});
