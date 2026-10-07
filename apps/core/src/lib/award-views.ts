import { awardFromRow, instanceFromRow, id, type AwardReader } from "./awards";
export type AwardBadge = {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
};
// Only public opt-ins; one query for all names on a page, never a query per name.
export async function getAwardBadgesWithDatabase(database: AwardReader, participantIds: string[]): Promise<Record<string, AwardBadge[]>> {
    if (!participantIds.length)
        return {};
    const result = await database.query(`SELECT i.participant_id,a.id,a.name,a.slug FROM award_instances i JOIN awards a ON a.id=i.award_id
    WHERE i.participant_id=ANY($1::uuid[]) AND i.status='accepted' AND i.show_next_to_name AND a.thumbnail_data IS NOT NULL ORDER BY a.established_on,a.id`, [[...new Set(participantIds.map(id))]]);
    const badges: Record<string, AwardBadge[]> = {};
    for (const row of result.rows)
        (badges[String(row.participant_id)] ??= []).push({ id: String(row.id), name: String(row.name), slug: String(row.slug), imageUrl: `/api/award-images/${row.id}/badge` });
    return badges;
}
export async function getPublicAwardWithDatabase(database: AwardReader, slug: string) {
    const result = await database.query("SELECT id,slug,name,image_url,established_on::text,description,criterion,public_address,kind,historical_cutoff_at,founder_participant_id,charter_version,created_at FROM awards WHERE slug=$1", [slug]);
    if (!result.rowCount)
        return null;
    const award = awardFromRow(result.rows[0]);
    const recipients = (await database.query(`SELECT p.id,p.display_name FROM award_instances i JOIN participants p ON p.id=i.participant_id
    WHERE i.award_id=$1 AND i.status='accepted' AND i.show_in_public_list ORDER BY lower(p.display_name),p.id`, [award.id])).rows;
    return { award, recipients: recipients.map(r => ({ id: String(r.id), name: String(r.display_name) })) };
}
export async function getOwnAwardOffersWithDatabase(database: AwardReader, viewer: string, instanceId?: string) {
    const result = await database.query(`SELECT i.*,a.slug,a.name,a.image_url,a.established_on::text,a.description,a.criterion,a.public_address,
    a.kind,a.historical_cutoff_at,a.founder_participant_id,a.charter_version,a.created_at,by_person.display_name AS awarder_name
    FROM award_instances i JOIN awards a ON a.id=i.award_id JOIN participants by_person ON by_person.id=i.awarded_by_participant_id
    WHERE i.participant_id=$1 AND ($2::uuid IS NULL OR i.id=$2) ORDER BY i.offered_at DESC`, [id(viewer), instanceId ? id(instanceId) : null]);
    return result.rows.map(r => ({ instance: instanceFromRow(r), award: awardFromRow({ ...r, id: r.award_id }), awarderName: String(r.awarder_name) }));
}
export async function getAwardBadges(ids: string[]) { const { pool } = await import("./db"); return getAwardBadgesWithDatabase(pool, ids); }
export async function getPublicAward(slug: string) { const { pool } = await import("./db"); return getPublicAwardWithDatabase(pool, slug); }
export async function getOwnAwardOffers(viewer: string, instance?: string) { const { pool } = await import("./db"); return getOwnAwardOffersWithDatabase(pool, viewer, instance); }
