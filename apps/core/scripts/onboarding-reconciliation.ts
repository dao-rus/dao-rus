import { readFileSync } from "node:fs";
import { Pool } from "pg";
import dotenv from "dotenv";

const migration = readFileSync(new URL("../migrations/026_onboarding_quests.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const history = migration.split("CREATE VIEW onboarding_first_action_history AS\n")[1]?.split(";\n-- END HISTORY QUERY")[0];
if (!history) throw new Error("Reconciliation history query missing");
// Exactly the migration's evidence query; the end is the dry-run snapshot, not a
// frozen apply deadline. The migration rechecks under write locks at cutover.
const sql = `BEGIN READ ONLY;
WITH history AS (${history}), reconciliation_window AS (SELECT '2026-10-02T10:42:19.468435061Z'::timestamptz AS start, clock_timestamp() AS finish),
candidates AS (
 SELECT DISTINCT history.participant_id FROM history CROSS JOIN reconciliation_window
 WHERE history.first_action_at >= reconciliation_window.start AND history.first_action_at < reconciliation_window.finish
   AND history.confirmed_action_at IS NOT NULL AND history.confirmed_action_at < reconciliation_window.finish
), satisfied AS (
 SELECT DISTINCT ledger.participant_id FROM darus_ledger ledger CROSS JOIN reconciliation_window
 WHERE ledger.source_type = 'residence_first_filled' AND ledger.created_at >= reconciliation_window.start AND ledger.created_at < reconciliation_window.finish
), pending AS (SELECT participant_id FROM candidates EXCEPT SELECT participant_id FROM satisfied)
SELECT jsonb_build_object('window_start', reconciliation_window.start, 'snapshot_end', reconciliation_window.finish,
 'historical_quest_completions', (SELECT count(*) FROM history),
 'participants_with_window_first_action', (SELECT count(*) FROM candidates),
 'already_satisfied_by_residence', (SELECT count(*) FROM satisfied),
 'participants_to_reward', (SELECT count(*) FROM pending),
 'darus_to_credit', (SELECT count(*) * 0.1 FROM pending)) AS dry_run FROM reconciliation_window;
ROLLBACK;`;
async function main() {
  if (process.argv.includes("--sql")) { console.log(sql); return; }
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const results = await client.query(sql);
    for (const result of Array.isArray(results) ? results : [results]) {
      if (result.rows[0]?.dry_run) console.log(JSON.stringify(result.rows[0].dry_run));
    }
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
