import type { ProposalDatabase, ProposalDatabaseClient } from "./proposals";

export type PollConfig = { circle: "dao" | "city"; mode: "secret" | "open"; deadline: Date | null };
export type VoteChoice = "yes" | "no" | "abstain";
export class VecheError extends Error { constructor(readonly code: "invalid" | "ineligible" | "closed" | "forbidden" | "missing") { super(`Veche ${code}`); } }
export type VecheSettings = { inactivityDays: number | null; quorumDao: number; quorumCity: number };
export type PollView = {
  id: string; title: string; body: string; authorId: string; circle: "dao" | "city"; mode: "secret" | "open";
  deadline: string | null; closedAt: string | null; turnout: number;
  result: null | { counts: Record<VoteChoice, number>; eligible: number; quorum: number; quorumReached: boolean };
  // This property exists ONLY for a closed open poll. There is no own-choice projection.
  publicVotes?: Array<{ participantId: string; displayName: string; choice: VoteChoice }>;
};
type Reader = { query: ProposalDatabaseClient["query"] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validPollId(id: string) { return uuid.test(id); }
export function normalizePollConfig(config: PollConfig): PollConfig {
  if (!config || !["dao", "city"].includes(config.circle) || !["secret", "open"].includes(config.mode)
      || (config.deadline !== null && (!(config.deadline instanceof Date) || !Number.isFinite(config.deadline.getTime()) || config.deadline.getTime() <= Date.now()))) throw new VecheError("invalid");
  return config;
}
export async function readVecheSettings(database: Reader): Promise<VecheSettings> {
  const row = (await database.query("SELECT inactivity_days,quorum_dao,quorum_city FROM veche_settings WHERE singleton")).rows[0];
  return { inactivityDays: row.inactivity_days === null ? null : Number(row.inactivity_days), quorumDao: Number(row.quorum_dao), quorumCity: Number(row.quorum_city) };
}
export function parseVecheSettings(values: { inactivityDays: unknown; quorumDao: unknown; quorumCity: unknown }): VecheSettings {
  const days = String(values.inactivityDays ?? "").trim();
  const fraction = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(raw)) throw new VecheError("invalid");
    return Number(raw);
  };
  if (days && (!/^\d{1,5}$/.test(days) || Number(days) < 1 || Number(days) > 36500)) throw new VecheError("invalid");
  return { inactivityDays: days ? Number(days) : null, quorumDao: fraction(values.quorumDao), quorumCity: fraction(values.quorumCity) };
}
export async function saveVecheSettings(database: Reader, settings: VecheSettings) {
  const checked = parseVecheSettings(settings);
  await database.query("UPDATE veche_settings SET inactivity_days=$1,quorum_dao=$2,quorum_city=$3 WHERE singleton", [checked.inactivityDays, checked.quorumDao, checked.quorumCity]);
}

// Polls and votes share the same row lock. Closure cannot reveal a partial or changing result.
export async function closeDuePolls(database: ProposalDatabase): Promise<void> {
  const client = await database.connect();
  try {
    const rows = (await client.query(`SELECT id FROM proposals,veche_settings s
      WHERE poll_circle IS NOT NULL AND poll_closed_at IS NULL AND
      (poll_deadline<=clock_timestamp() OR (poll_deadline IS NULL AND s.inactivity_days IS NOT NULL
        AND poll_last_new_vote_at+make_interval(days=>s.inactivity_days)<=clock_timestamp())) ORDER BY id`)).rows;
    for (const row of rows) await client.query("SELECT veche_close_poll($1)", [row.id]);
  } finally { client.release(); }
}
export async function castVoteWithDatabase(database: ProposalDatabase, id: string, participantId: string, choice: unknown): Promise<void> {
  if (!validPollId(id) || !["yes", "no", "abstain"].includes(String(choice))) throw new VecheError("invalid");
  const client = await database.connect();
  let blocked: VecheError | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT veche_close_poll($1)", [id]);
    const row = (await client.query("SELECT poll_circle,poll_city,poll_closed_at FROM proposals WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row || !row.poll_circle) blocked = new VecheError("missing");
    else if (row.poll_closed_at) blocked = new VecheError("closed");
    else {
      const voter = (await client.query("SELECT veche_eligible(p,$2,$3) AS eligible FROM participants p WHERE id=$1 FOR SHARE", [participantId, row.poll_circle, row.poll_city])).rows[0];
      if (!voter || voter.eligible !== true) blocked = new VecheError("ineligible");
      else await client.query(`INSERT INTO proposal_votes(proposal_id,participant_id,choice) VALUES($1,$2,$3)
        ON CONFLICT(proposal_id,participant_id) DO UPDATE SET choice=EXCLUDED.choice`, [id, participantId, choice]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (blocked) throw blocked;
}
export async function closePollWithDatabase(database: ProposalDatabase, id: string, authorId: string): Promise<void> {
  if (!validPollId(id)) throw new VecheError("invalid");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT author_participant_id,poll_circle,poll_deadline FROM proposals WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row || !row.poll_circle) throw new VecheError("missing");
    if (String(row.author_participant_id).toLowerCase() !== authorId.toLowerCase() || row.poll_deadline) throw new VecheError("forbidden");
    await client.query("SELECT veche_close_poll($1,$2)", [id, authorId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

// Explicit allowlist shared by API, HTML/RSC and administration; never return database rows.
export async function getPollViewWithDatabase(database: ProposalDatabase, id: string): Promise<PollView | null> {
  if (!validPollId(id)) return null;
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT veche_close_poll($1)", [id]);
    const p = (await client.query(`SELECT id,title,body,author_participant_id,poll_circle,poll_mode,poll_deadline,poll_closed_at,poll_eligible_count,poll_quorum
      FROM proposals WHERE id=$1 AND poll_circle IS NOT NULL FOR SHARE`, [id])).rows[0];
    if (!p) { await client.query("COMMIT"); return null; }
    const iso = (date: unknown) => date ? new Date(String(date)).toISOString() : null;
    const turnout = Number((await client.query("SELECT count(*) AS n FROM proposal_votes WHERE proposal_id=$1", [id])).rows[0].n);
    const view: PollView = { id: String(p.id), title: String(p.title), body: String(p.body), authorId: String(p.author_participant_id),
      circle: p.poll_circle as PollView["circle"], mode: p.poll_mode as PollView["mode"], deadline: iso(p.poll_deadline), closedAt: iso(p.poll_closed_at), turnout, result: null };
    if (view.closedAt) {
      const counts: Record<VoteChoice, number> = { yes: 0, no: 0, abstain: 0 };
      for (const row of (await client.query("SELECT choice,count(*) AS n FROM proposal_votes WHERE proposal_id=$1 GROUP BY choice", [id])).rows) counts[row.choice as VoteChoice] = Number(row.n);
      const eligible = Number(p.poll_eligible_count), quorum = Number(p.poll_quorum);
      view.result = { counts, eligible, quorum, quorumReached: quorum === 0 || turnout >= Math.ceil(eligible * quorum) };
      if (view.mode === "open") view.publicVotes = (await client.query(`SELECT v.participant_id,p.display_name,v.choice FROM proposal_votes v
        JOIN participants p ON p.id=v.participant_id WHERE v.proposal_id=$1 ORDER BY v.participant_id`, [id])).rows
        .map(row => ({ participantId: String(row.participant_id), displayName: String(row.display_name), choice: row.choice as VoteChoice }));
    }
    await client.query("COMMIT"); return view;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function canVoteInPoll(database: Reader, id: string, participantId: string): Promise<boolean> {
  const row = (await database.query(`SELECT veche_eligible(member,p.poll_circle,p.poll_city) AS eligible
    FROM proposals p,participants member WHERE p.id=$1 AND member.id=$2 AND p.poll_circle IS NOT NULL AND p.poll_closed_at IS NULL`, [id, participantId])).rows[0];
  return row?.eligible === true;
}
export async function getPollView(id: string) { const { pool } = await import("./db"); return getPollViewWithDatabase(pool, id); }
export async function castVote(id: string, participantId: string, choice: unknown) { const { pool } = await import("./db"); return castVoteWithDatabase(pool, id, participantId, choice); }
export async function closePoll(id: string, participantId: string) { const { pool } = await import("./db"); return closePollWithDatabase(pool, id, participantId); }
