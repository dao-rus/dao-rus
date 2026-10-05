import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { renderDepartureReviewHtml } from "../src/lib/telegram-departure-review-html";
import { archiveDigest, parseArchive, previewDepartureArchive, loadArchiveParticipants,
  applyDepartureArchive, addHistoricalRosterAliases, withOcrEvidence, departureChannel, departureReviewModel, summarizeDepartureArchive, type ArchiveParticipant, type Review } from "../src/lib/telegram-departure-archive";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  const [file, ...args] = process.argv.slice(2);
  const options = new Map<string, string>();
  let apply = false;
  let dryRun = false;
  let historicalOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") { apply = true; continue; }
    if (args[i] === "--dry-run") { dryRun = true; continue; }
    if (args[i] === "--historical-only") { historicalOnly = true; continue; }
    if (!["--review", "--expected-confirmed-count", "--expected-confirmed-sha256", "--output", "--participants", "--historical-roster", "--historical-roster-dir", "--ocr-evidence", "--review-html"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || options.has(args[i])) throw new Error("Invalid arguments");
    options.set(args[i], args[++i]);
  }
  if (!file || (apply && (dryRun || !options.has("--review") || [...options.keys()].some(k => !["--review", "--expected-confirmed-count", "--expected-confirmed-sha256"].includes(k)))) || (!apply && (historicalOnly || ["--review", "--expected-confirmed-count", "--expected-confirmed-sha256"].some(k => options.has(k))))) {
    throw new Error("Usage: telegram:departures:import -- archive.json [--dry-run] [--participants local-participants.json] [--output report.json] OR archive.json --apply --review reviewed.json");
  }
  const source = await fs.readFile(file, "utf8");
  let archive = parseArchive(JSON.parse(source));
  const digest = archiveDigest(source);
  let ocrSha256: string | null = null;
  if (options.has("--ocr-evidence")) {
    const evidence = await fs.readFile(options.get("--ocr-evidence")!, "utf8");
    archive = withOcrEvidence(archive, digest, JSON.parse(evidence));
    ocrSha256 = archiveDigest(evidence);
  }
  if (apply) {
    const review = JSON.parse(await fs.readFile(options.get("--review")!, "utf8")) as Review;
    const { pool } = await import("../src/lib/db");
    const expectedCount = options.has("--expected-confirmed-count") ? Number(options.get("--expected-confirmed-count")) : undefined;
    const expectedSha = options.get("--expected-confirmed-sha256");
    if ((expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) || (expectedSha !== undefined && !/^[0-9a-f]{64}$/.test(expectedSha))) throw new Error("Invalid frozen confirmation count/digest");
    try { console.log(JSON.stringify({ mode: "apply", ...await applyDepartureArchive(pool, archive, digest, review, { historicalOnly, expectedConfirmedCount: expectedCount, expectedConfirmedSha256: expectedSha }) })); }
    finally { await pool.end(); }
    return;
  }
  let participants: ArchiveParticipant[];
  if (options.has("--participants")) {
    participants = JSON.parse(await fs.readFile(options.get("--participants")!, "utf8"));
  } else {
    const { pool } = await import("../src/lib/db");
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      participants = await loadArchiveParticipants(client);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await pool.end(); }
  }
  const snapshotFiles = new Set<string>();
  if (options.has("--historical-roster")) snapshotFiles.add(path.resolve(options.get("--historical-roster")!));
  async function findSnapshots(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await findSnapshots(location);
      else if (entry.isFile() && /^telegram-roster.*\.json$/i.test(entry.name)) snapshotFiles.add(path.resolve(location));
    }
  }
  if (options.has("--historical-roster-dir")) await findSnapshots(options.get("--historical-roster-dir")!);
  const historicalSources: { file: string; sha256: string }[] = [];
  for (const snapshot of [...snapshotFiles].sort()) {
    const contents = await fs.readFile(snapshot, "utf8");
    addHistoricalRosterAliases(participants, JSON.parse(contents), path.basename(snapshot));
    historicalSources.push({ file: snapshot, sha256: archiveDigest(contents) });
  }
  const rows = previewDepartureArchive(archive, participants);
  const summary = summarizeDepartureArchive(rows);
  const report = { mode: "dry-run", model_version: departureReviewModel, source_channel: departureChannel, archive_sha256: digest, ocr_evidence_sha256: ocrSha256, historical_roster_sources: historicalSources, summary, rows,
    mappings: rows.map(r => ({ source_message_id: r.source_message_id, archived_username: null, participant_id: null, target: null,
      event_type: "forum.left", confirmed: false })) };
  const output = options.get("--output") ?? path.join(path.dirname(file), "departure-review.json");
  if (path.resolve(output) === path.resolve(file) || (options.get("--participants") && path.resolve(output) === path.resolve(options.get("--participants")!))) throw new Error("Report must not overwrite its input");
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  const cell = (value: unknown) => String(value ?? "—").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const table = ["# Departure archive OCR dry-run", "", `Archive SHA-256: ${digest}`, "", "All mappings require human confirmation. OCR is evidence only.", "",
    "Forecast counts include unconfirmed OCR/caption candidates. Multiple options require selecting the correct username; counts may decrease after review.", "",
    ...Object.entries(summary).filter(([, value]) => typeof value === "number").map(([status, count]) => `- ${status}: ${count}`), "",
    "| Message id | Date (UTC) | OCR name / username | Username options | Current / reconstructed participants | Review state |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.source_message_id} | ${cell(r.archive_date)} | ${cell([...r.ocr_usernames.map(u => "@" + u), ...r.ocr_names].join(" / "))} | ${cell(r.username_options.map(o => o.archived_username).join(" / "))} | ${cell(r.username_options.flatMap(o => [...o.current_matches, ...o.reconstructed_matches]).map(p => `${p.current_display_name} (${p.participant_id}): ${p.basis}`).join(" / "))} | ${r.status} |`),
    "", "## Repeated usernames (one historical Participant per confirmed username)", "",
    ...summary.repeated_username_groups.map(g => `- ${g.archived_username}: messages ${g.source_message_ids.join(", ")}`),
  ].join("\n") + "\n";
  await fs.writeFile(output + ".md", table, { flag: "wx" });
  if (options.has("--review-html")) {
    const images: Record<string, string[]> = {};
    const root = await fs.realpath(path.dirname(path.resolve(file)));
    for (const m of archive.messages) {
      images[m.id] = [];
      for (const image of (m.images ?? []) as { path: string; mime_type?: string }[]) {
        const location = await fs.realpath(image.path);
        const relative = path.relative(root, location);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Review image must be inside the archive directory");
        const mime = image.mime_type ?? "image/jpeg";
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Unsupported review image format");
        images[m.id].push(`data:${mime};base64,${(await fs.readFile(location)).toString("base64")}`);
      }
    }
    await fs.writeFile(options.get("--review-html")!, renderDepartureReviewHtml({ model_version: departureReviewModel, source_channel: departureChannel, archive_sha256: digest, summary, rows, participants, images }), { flag: "wx" });
    console.log(`Local human-review page: ${options.get("--review-html")}`);
  }
  console.table(rows.map(r => ({ source_message_id: r.source_message_id, archive_date: r.archive_date, usernames: r.username_options.map(o => o.archived_username).join(", "), status: r.status })));
  console.log(`Dry-run report (all confirmations false): ${output}`);
  console.log(JSON.stringify({ summary, candidateTable: output + ".md" }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Departure archive import failed"); process.exitCode = 1; });
