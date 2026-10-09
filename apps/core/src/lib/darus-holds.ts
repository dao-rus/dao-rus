import { parseDarusAmount, type TokenizationClient, type TokenizationDatabase } from "./tokenization";

type Source = { sourceType: string; sourceId: string };
export type DarusHoldInput = Source & { participantId: string; amount: string };
export type DarusDistribution = { participantId: string; amount: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class DarusMovementConflict extends Error {
  constructor() { super("DARUS operation already exists with different parameters"); this.name = "DarusMovementConflict"; }
}
function validate(source: Source, participantId: string, amount: string) {
  if (!uuid.test(source.sourceId) || !uuid.test(participantId) || !/^[a-z][a-z0-9_.:]{0,63}$/.test(source.sourceType)) throw new Error("Invalid DARUS operation source");
  parseDarusAmount(amount);
}
function exact(amount: string) { const [whole, fraction = ""] = amount.split("."); return `${whole}.${fraction.padEnd(6, "0")}`; }
async function transaction<T>(database: Pick<TokenizationDatabase, "connect">, run: (client: TokenizationClient) => Promise<T>) {
  const client = await database.connect();
  try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

// The caller is a Core domain service. No channel-specific behavior or public money API.
export async function holdDarusWithDatabase(database: Pick<TokenizationDatabase, "connect">, input: DarusHoldInput): Promise<string> {
  validate(input, input.participantId, input.amount);
  input = { ...input, sourceId: input.sourceId.toLowerCase(), participantId: input.participantId.toLowerCase() };
  return transaction(database, async client => {
    // Claim the operation before checking it; an identical retry must work even after spending the balance.
    await client.query("SELECT pg_advisory_xact_lock(45001, hashtext($1))", [JSON.stringify([input.sourceType, input.sourceId, input.participantId])]);
    const existing = await client.query("SELECT id,amount FROM darus_holds WHERE source_type=$1 AND source_id=$2::uuid AND participant_id=$3::uuid", [input.sourceType, input.sourceId, input.participantId]);
    if (existing.rowCount) {
      if (String(existing.rows[0].amount) !== exact(input.amount)) throw new DarusMovementConflict();
      return String(existing.rows[0].id);
    }
    const result = await client.query("INSERT INTO darus_holds(participant_id,amount,source_type,source_id) VALUES($1::uuid,$2::numeric,$3,$4::uuid) RETURNING id", [input.participantId, input.amount, input.sourceType, input.sourceId]);
    return String(result.rows[0].id);
  });
}
async function releaseHeld(database: Pick<TokenizationDatabase, "connect">, holdId: string, source: Source, allocations: DarusDistribution[], kind: "distribution" | "refund") {
  if (!uuid.test(holdId) || !allocations.length || new Set(allocations.map(row => row.participantId)).size !== allocations.length) throw new Error("Invalid DARUS allocation");
  for (const row of allocations) validate(source, row.participantId, row.amount);
  holdId = holdId.toLowerCase();
  source = { ...source, sourceId: source.sourceId.toLowerCase() };
  allocations = allocations.map(row => ({ ...row, participantId: row.participantId.toLowerCase() }));
  if (new Set(allocations.map(row => row.participantId)).size !== allocations.length) throw new Error("Invalid DARUS allocation");
  return transaction(database, async client => {
    const held = await client.query("SELECT id FROM darus_holds WHERE id=$1::uuid FOR UPDATE", [holdId]);
    if (!held.rowCount) throw new Error("DARUS hold does not exist");
    const ids: string[] = [];
    for (const row of [...allocations].sort((a, b) => a.participantId.localeCompare(b.participantId))) {
      await client.query("SELECT pg_advisory_xact_lock(45001, hashtext($1))", [JSON.stringify([source.sourceType, source.sourceId, row.participantId])]);
      const existing = await client.query("SELECT id,amount,kind,hold_id FROM darus_movements WHERE source_type=$1 AND source_id=$2::uuid AND participant_id=$3::uuid", [source.sourceType, source.sourceId, row.participantId]);
      if (existing.rowCount) {
        const prior = existing.rows[0];
        if (String(prior.amount) !== exact(row.amount) || prior.kind !== kind || prior.hold_id !== holdId) throw new DarusMovementConflict();
        ids.push(String(prior.id));
      } else {
        const result = await client.query("INSERT INTO darus_movements(participant_id,hold_id,kind,amount,source_type,source_id) VALUES($1::uuid,$2::uuid,$3,$4::numeric,$5,$6::uuid) RETURNING id", [row.participantId, holdId, kind, row.amount, source.sourceType, source.sourceId]);
        ids.push(String(result.rows[0].id));
      }
    }
    return ids;
  });
}
export async function distributeHeldDarusWithDatabase(database: Pick<TokenizationDatabase, "connect">, holdId: string, source: Source, allocations: DarusDistribution[]) {
  return releaseHeld(database, holdId, source, allocations, "distribution");
}
export async function refundHeldDarusWithDatabase(database: Pick<TokenizationDatabase, "connect">, holdId: string, source: Source, participantId: string, amount: string) {
  return (await releaseHeld(database, holdId, source, [{ participantId, amount }], "refund"))[0];
}
export async function getDarusBookWithDatabase(database: Pick<TokenizationDatabase, "query">, participantId: string) {
  if (!uuid.test(participantId)) throw new Error("Invalid participant");
  return (await database.query("SELECT id,amount,currency,kind,source_type,source_id,hold_id,created_at FROM darus_book WHERE participant_id=$1::uuid ORDER BY created_at DESC,id DESC", [participantId])).rows;
}

// The audit helper above is internal; every caller-facing book carries a viewer.
export async function getVisibleDarusBookWithDatabase(database: Pick<TokenizationDatabase,"query">,participantId:string,viewerId:string|null) {
 if(!uuid.test(participantId)||(viewerId!==null&&!uuid.test(viewerId)))throw new Error("Invalid participant");
 return (await database.query("SELECT * FROM darus_visible_book($1::uuid,$2::uuid)",[participantId,viewerId])).rows;
}

export async function getOwnDarusBook(participantId:string){const{pool}=await import("./db");return getVisibleDarusBookWithDatabase(pool,participantId,participantId);}
