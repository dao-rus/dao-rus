import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { importIntroductions, parseIntroductionEntries, IntroductionImportValidationError } from "../src/lib/introduction-import";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// The data file holds personal data and lives outside the repository. Output is counters only.
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== "--dry-run" && args[1] !== "--apply")) {
    throw new Error("Usage: npm run introductions:import -- <introductions.json> [--dry-run|--apply]");
  }
  let data: unknown;
  try { data = JSON.parse(await fs.readFile(path.resolve(args[0]), "utf8")); }
  catch { throw new Error("Invalid JSON file"); }
  const entries = parseIntroductionEntries(data);
  const apply = args[1] === "--apply";
  const [{ pool }, { readInterfaceTexts }] = await Promise.all([import("../src/lib/db"), import("../src/lib/interface-texts")]);
  try {
    const { values } = await readInterfaceTexts();
    const result = await importIntroductions(pool, entries, { both: values["guardian.introduction_both"],
      city: values["guardian.introduction_city"], interests: values["guardian.introduction_interests"],
      action: values["guardian.introduction_action"] }, apply);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }));
  } finally { await pool.end(); }
}

main().catch((error) => {
  console.error(error instanceof IntroductionImportValidationError || error instanceof Error ? error.message : "Introduction import failed");
  process.exitCode = 1;
});
