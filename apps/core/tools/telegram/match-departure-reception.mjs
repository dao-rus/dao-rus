// Offline read-only audit. No database or Telegram client; no apply mode.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
if (args.length !== 3 || args.some(value => value.startsWith("--"))) throw new Error("Usage: node match-departure-reception.mjs <verified-receipt.json> <reception-export.json> <output-directory>");
const [receiptFile, exportFile, output] = args.map(value => path.resolve(value));
const allowed = path.resolve(".local/queue");
if (!output.startsWith(allowed + path.sep)) throw new Error("Output must be inside apps/core/.local/queue (run from apps/core)");
const receiptBytes = fs.readFileSync(receiptFile), exportBytes = fs.readFileSync(exportFile);
const receipt = JSON.parse(receiptBytes), reception = JSON.parse(exportBytes);
if (!Array.isArray(receipt.rows) || !Array.isArray(reception.messages)) throw new Error("Invalid receipt/export structure");
const normalize = value => String(value ?? "").trim().replace(/^@/, "").toLowerCase();
const handles = text => [...String(text ?? "").matchAll(/(?:@|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([a-z0-9_]{4,32})(?![a-z0-9_])/ig)].map(match => normalize(match[1]));
const evidence = new Map();
for (const message of reception.messages) {
  const text = typeof message.text === "string" ? message.text : (message.text ?? []).map(part => typeof part === "string" ? part : part.text ?? "").join("");
  const nicknames = new Set(handles(text));
  for (const entity of message.text_entities ?? []) for (const nickname of handles(entity.href)) nicknames.add(nickname);
  // A display name without an explicit @ is never treated as a Telegram username.
  const direct = /^@[a-z0-9_]{4,32}$/i.test(message.from ?? "") ? normalize(message.from) : null;
  if (direct) nicknames.add(direct);
  for (const nickname of nicknames) {
    const entries = evidence.get(nickname) ?? [];
    entries.push({ message_id: message.id, date: message.date, date_unixtime: message.date_unixtime,
      source: exportFile, basis: direct === nickname ? "explicit_sender_username" : "exact_username_reference",
      sender_id: direct === nickname ? message.from_id ?? null : null });
    evidence.set(nickname, entries);
  }
}
const groups = { unambiguous: [], doubtful: [], unmatched: [] };
for (const row of receipt.rows) {
  const nickname = normalize(row.payload?.archived_username);
  if (!nickname) throw new Error("Missing confirmed archived username");
  const candidates = evidence.get(nickname) ?? [];
  const direct = candidates.filter(candidate => candidate.basis === "explicit_sender_username" && candidate.sender_id);
  const identities = new Set(direct.map(candidate => candidate.sender_id));
  const group = !candidates.length ? "unmatched" : identities.size === 1 && direct.length === candidates.length ? "unambiguous" : "doubtful";
  const dates = direct.map(candidate => Number(candidate.date_unixtime)).filter(Number.isFinite).sort((a, b) => a - b);
  groups[group].push({ participant_id: row.id, nickname: row.payload.archived_username,
    arrival_date: null, first_presence_at: group === "unambiguous" && dates.length ? new Date(dates[0] * 1000).toISOString() : null,
    source: { receipt: receiptFile, export: exportFile }, candidates,
    note: group === "unmatched" ? "No exact username evidence; arrival unknown" : "First presence is not a proven arrival; references do not identify their sender" });
}
const counts = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length]));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
fs.mkdirSync(output, { recursive: true });
for (const file of ["matches.json", "matches.html"]) if (fs.existsSync(path.join(output, file))) throw new Error("Output already exists; choose a new directory");
fs.writeFileSync(path.join(output, "matches.json"), JSON.stringify({ mode: "read-only", receipt_sha256: digest(receiptBytes), export_sha256: digest(exportBytes), counts, groups }, null, 2));
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const labels = { unambiguous: "Однозначные", doubtful: "Сомнительные", unmatched: "Без совпадения" };
fs.writeFileSync(path.join(output, "matches.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Сопоставление архива с Приёмной</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:10px;text-align:left}</style><h1>Сопоставление по точному нику</h1><p>База не изменялась. Первое присутствие не доказывает дату прихода. Имена и похожие ники не сопоставлялись.</p>' + Object.entries(groups).map(([key, rows]) => '<h2>' + labels[key] + ' (' + rows.length + ')</h2><table><tr><th>Ник</th><th>Дата прихода</th><th>Источник</th><th>Свидетельства</th></tr>' + rows.map(row => '<tr><td>' + escape(row.nickname) + '</td><td>' + escape(row.arrival_date ?? 'неизвестна') + '</td><td>' + escape(exportFile) + '<br>' + escape(receiptFile) + '</td><td>' + escape(JSON.stringify(row.candidates)) + '</td></tr>').join('') + '</table>').join(''));
console.log(JSON.stringify({ mode: "read-only", counts }));
