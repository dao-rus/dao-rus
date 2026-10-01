import { normalizeInterest, normalizeResidence, type Residence } from "./profile-about";

export type Community = { type: "interest"; interest: string } | { type: "residence"; residence: Residence };
type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type CommunityClient = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type CommunityDatabase = { query(text: string, values?: unknown[]): Promise<QueryResult>; connect(): Promise<CommunityClient> };

export function communityFromParams(params: {
  interest?: unknown; residence_name?: unknown; residence_type?: unknown; residence_country?: unknown;
}): Community | null {
  if (params.interest && (params.residence_name || params.residence_type || params.residence_country)) return null;
  if (typeof params.interest === "string" && params.interest.trim()) {
    try { return { type: "interest", interest: normalizeInterest(params.interest) }; } catch { return null; }
  }
  if (!params.residence_name && !params.residence_type && !params.residence_country) return null;
  try {
    const residence = normalizeResidence({ name: params.residence_name, type: params.residence_type, country: params.residence_country });
    return residence ? { type: "residence", residence } : null;
  } catch { return null; }
}

export function communityKey(community: Community): string {
  return community.type === "interest"
    ? community.interest.toLocaleLowerCase("ru-RU")
    : JSON.stringify([community.residence.country, community.residence.type, community.residence.name]
      .map((part) => part.toLocaleLowerCase("ru-RU")));
}

export function communityHref(community: Community): string {
  const query = community.type === "interest"
    ? new URLSearchParams({ interest: community.interest })
    : new URLSearchParams({ residence_name: community.residence.name,
      residence_type: community.residence.type, residence_country: community.residence.country });
  return `/participants?${query}`;
}

export type CommunityPost = { id: string; body: string; authorId: string; authorName: string; createdAt: Date };
export type CommunitySignal = { participantId: string; kind: "want" | "need" | "can" | "have"; body: string };

export async function listCommunityPostsWithDatabase(database: Pick<CommunityDatabase, "query">, community: Community): Promise<CommunityPost[]> {
  const result = await database.query(
    `SELECT post.id, post.body, post.author_id, author.display_name AS author_name, post.created_at
       FROM community_post_targets target
       JOIN community_posts post ON post.id = target.post_id
       JOIN participants author ON author.id = post.author_id
      WHERE target.community_type = $1 AND target.community_key = $2
        AND post.deleted_at IS NULL
      ORDER BY post.created_at DESC, post.id DESC LIMIT 100`,
    [community.type, communityKey(community)],
  );
  return result.rows.map((row) => ({ id: String(row.id), body: String(row.body),
    authorId: String(row.author_id), authorName: String(row.author_name), createdAt: new Date(String(row.created_at)) }));
}

export async function listCommunitySignalsWithDatabase(
  database: Pick<CommunityDatabase, "query">, memberIds: string[], viewerId: string,
): Promise<CommunitySignal[]> {
  if (!memberIds.length) return [];
  const result = await database.query(
    `SELECT participant_id, kind, body FROM profile_signals
      WHERE participant_id = ANY($1::uuid[]) AND status = 'active'
        AND (visibility IN ('public', 'members') OR participant_id = $2::uuid)
      ORDER BY created_at DESC, id DESC`,
    [memberIds, viewerId],
  );
  return result.rows.map((row) => ({ participantId: String(row.participant_id),
    kind: String(row.kind) as CommunitySignal["kind"], body: String(row.body) }));
}

export async function isCommunityMemberWithDatabase(
  database: Pick<CommunityDatabase, "query">, community: Community, participantId: string,
): Promise<boolean> {
  const result = community.type === "interest"
    ? await database.query(
      `SELECT 1 FROM participant_interests WHERE participant_id = $1::uuid
        AND normalized_label = $2 LIMIT 1`,
      [participantId, communityKey(community)],
    )
    : await database.query(
      `SELECT 1 FROM participants WHERE id = $1::uuid
        AND lower(residence_name) = $2 AND lower(residence_type) = $3
        AND lower(residence_country) = $4 LIMIT 1`,
      [participantId, community.residence.name.toLocaleLowerCase("ru-RU"),
        community.residence.type.toLocaleLowerCase("ru-RU"),
        community.residence.country.toLocaleLowerCase("ru-RU")],
    );
  return Boolean(result.rowCount);
}

export class CommunityPostValidationError extends Error {}
export class CommunityMembershipError extends Error {}

export async function createCommunityPostWithDatabase(
  database: CommunityDatabase, community: Community, authorId: string, bodyValue: unknown,
): Promise<void> {
  if (typeof bodyValue !== "string" || !bodyValue.trim() || bodyValue.trim().length > 2000) {
    throw new CommunityPostValidationError("Invalid announcement");
  }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    if (!await isCommunityMemberWithDatabase(client, community, authorId)) throw new CommunityMembershipError("Not a community member");
    const post = await client.query(
      `INSERT INTO community_posts(author_id, body) VALUES ($1::uuid, $2) RETURNING id`,
      [authorId, bodyValue.trim()],
    );
    const postId = String(post.rows[0].id);
    await client.query(
      `INSERT INTO community_post_targets(post_id, community_type, community_key)
       VALUES ($1::uuid, $2, $3)`,
      [postId, community.type, communityKey(community)],
    );
    await client.query("INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)",
      ["community.post_created", authorId, JSON.stringify({ post_id: postId })]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deleteCommunityPostWithDatabase(
  database: CommunityDatabase, community: Community, authorId: string, postId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
    throw new CommunityPostValidationError("Invalid post id");
  }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE community_posts post SET deleted_at = now()
        FROM community_post_targets target
       WHERE post.id = $1::uuid AND post.author_id = $2::uuid AND post.deleted_at IS NULL
         AND target.post_id = post.id AND target.community_type = $3 AND target.community_key = $4
       RETURNING post.id`,
      [postId, authorId, community.type, communityKey(community)],
    );
    if (result.rowCount) await client.query(
      "INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)",
      ["community.post_deleted", authorId, JSON.stringify({ post_id: postId })],
    );
    await client.query("COMMIT");
    return Boolean(result.rowCount);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listCommunityPosts(community: Community) {
  const { pool } = await import("./db");
  return listCommunityPostsWithDatabase(pool, community);
}
export async function listCommunitySignals(memberIds: string[], viewerId: string) {
  const { pool } = await import("./db");
  return listCommunitySignalsWithDatabase(pool, memberIds, viewerId);
}
export async function createCommunityPost(community: Community, authorId: string, body: unknown) {
  const { pool } = await import("./db");
  return createCommunityPostWithDatabase(pool, community, authorId, body);
}
export async function deleteCommunityPost(community: Community, authorId: string, postId: string) {
  const { pool } = await import("./db");
  return deleteCommunityPostWithDatabase(pool, community, authorId, postId);
}
