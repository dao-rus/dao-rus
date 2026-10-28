import { pool } from "../src/lib/db";
import { applyReceptionDraftWithClient } from "../src/lib/reception-profile-apply";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--dry-run"].includes(arg)) || args.length > 1) throw new Error("Use --dry-run (default) or --apply");
  const apply = args[0] === "--apply";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const drafts = (await client.query("SELECT telegram_user_id FROM reception_applications WHERE status='draft' ORDER BY telegram_user_id")).rows;
    const changed = [];
    let linked = 0;
    for (const draft of drafts) {
      const result = await applyReceptionDraftWithClient(client, draft.telegram_user_id);
      if (result.participantId) linked++;
      if (result.fields.length) changed.push(result);
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", drafts: drafts.length,
      resolvedProfiles: linked, changedProfiles: changed.length, changed }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch(() => { console.error("Reception profile backfill failed; transaction rolled back. Check identity and database constraints before retrying."); process.exitCode = 1; });
