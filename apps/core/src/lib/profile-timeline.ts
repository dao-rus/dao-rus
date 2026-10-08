// The dates a profile header shows: when the person came, and whether they have since gone.
// Each departure is told exactly as it happened: leaving the forum in silence is not the same
// as a recorded decision to leave the DAO, and a removal is not shown as either.
type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
export type ProfileTimeline = { joinedAt: Date | null; leftForumAt: Date | null; leftDaoAt: Date | null };

export async function getProfileTimelineWithDatabase(database: Queryable, participantId: string): Promise<ProfileTimeline> {
  const result = await database.query(
    `WITH lifecycle AS (
       SELECT event_type, COALESCE((payload->>'observed_at')::timestamptz, created_at) AS at, id
         FROM events WHERE participant_id = $1::uuid
          AND event_type IN ('forum.joined', 'forum.rejoined', 'forum.left', 'forum.removed', 'onboarding.forum_joined'))
     SELECT (SELECT min(at) FROM lifecycle WHERE event_type = 'forum.joined') AS joined_at,
            (SELECT CASE WHEN last.event_type = 'forum.left' THEN last.at END
               FROM (SELECT event_type, at FROM lifecycle ORDER BY at DESC, id DESC LIMIT 1) last
              WHERE NOT EXISTS (SELECT 1 FROM participant_forum_onboarding forum
                                 WHERE forum.participant_id = $1::uuid AND forum.forum_status = 'joined')) AS left_forum_at,
            (SELECT max(left_event.created_at) FROM participants p
               JOIN events left_event ON left_event.participant_id = p.id AND left_event.event_type = 'membership.left'
              WHERE p.id = $1::uuid AND p.membership_status = 'left') AS left_dao_at`,
    [participantId]);
  const row = result.rows[0] ?? {};
  const date = (value: unknown) => value ? new Date(String(value)) : null;
  return { joinedAt: date(row.joined_at), leftForumAt: date(row.left_forum_at), leftDaoAt: date(row.left_dao_at) };
}

export async function getProfileTimeline(participantId: string): Promise<ProfileTimeline> {
  const { pool } = await import("./db");
  return getProfileTimelineWithDatabase(pool, participantId);
}
