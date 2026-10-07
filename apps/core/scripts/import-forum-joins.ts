import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { importForumJoins, parseForumJoinEntries } from "../src/lib/forum-join-history";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// The data file holds Telegram user IDs and lives outside the repository. Output is counters only.
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== "--dry-run" && args[1] !== "--apply")) {
    throw new Error("Usage: npm run telegram:forum:joins -- <forum-joins.json> [--dry-run|--apply]");
  }
  let data: unknown;
  try { data = JSON.parse(await fs.readFile(path.resolve(args[0]), "utf8")); }
  catch { throw new Error("Invalid JSON file"); }
  const entries = parseForumJoinEntries(data);
  const apply = args[1] === "--apply";
  const { pool } = await import("../src/lib/db");
  try { console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...(await importForumJoins(pool, entries, apply)) })); }
  finally { await pool.end(); }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Forum join import failed");
  process.exitCode = 1;
});
