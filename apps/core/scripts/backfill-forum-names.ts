import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// One-off: gives forum members still shown as the placeholder their Telegram name. Counters only.
async function main() {
  const mode = process.argv[2] ?? "--dry-run";
  if (process.argv.length > 3 || (mode !== "--dry-run" && mode !== "--apply")) {
    throw new Error("Usage: npm run telegram:forum:names -- [--dry-run|--apply]");
  }
  const [{ pool }, { backfillForumMemberNames }] = await Promise.all([import("../src/lib/db"), import("../src/lib/telegram-forum-onboarding")]);
  try {
    console.log(JSON.stringify({ mode: mode.slice(2), ...(await backfillForumMemberNames(pool, mode === "--apply")) }));
  } finally { await pool.end(); }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Forum name backfill failed");
  process.exitCode = 1;
});
