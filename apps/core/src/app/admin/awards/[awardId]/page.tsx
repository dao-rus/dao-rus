import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAwardAdmin, awardRouteId } from "@/lib/award-admin";
import { getAwardWithDatabase } from "@/lib/awards";
import { pool } from "@/lib/db";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { AwardContent, AwardNotice } from "@/components/award-content";
import { LocalDateTime } from "@/components/local-date-time";
export const dynamic = "force-dynamic";
export const metadata = { title: "Награда · Учредитель" };
export default async function AwardAdminPage({ params, searchParams }: {
    params: Promise<{
        awardId: string;
    }>;
    searchParams: Promise<{
        award_update?: string;
    }>;
}) {
    await requireAwardAdmin();
    const awardId = awardRouteId((await params).awardId);
    const award = await getAwardWithDatabase(pool, awardId);
    if (!award)
        notFound();
    const [batches, counts, { values: texts }, query] = await Promise.all([
        pool.query("SELECT * FROM award_batches WHERE award_id=$1 ORDER BY created_at DESC", [awardId]),
        pool.query("SELECT status,count(*)::int AS count FROM award_instances WHERE award_id=$1 GROUP BY status", [awardId]), readInterfaceTexts(), searchParams
    ]);
    return <main className="shell"><section className="card"><Link href="/admin/awards">{texts["award.back"]}</Link>
    <AwardNotice notice={query.award_update} texts={texts}/><AwardContent award={award} texts={texts}/>
    <p><Link href={`/awards/${award.slug}`}>{texts["award.publicPage"]}</Link></p>
    <ul>{counts.rows.map(row => <li key={row.status}>{texts[`award.${row.status as "offered" | "declined" | "accepted" | "rejected"}`]}: {row.count}</li>)}</ul>
    <form action="/api/admin/awards/batches" method="post" className="awardForm"><input type="hidden" name="action" value="create"/><input type="hidden" name="awardId" value={award.id}/>
      <select name="kind"><option value="regular">{texts["award.regular"]}</option>{award.kind === "historical" ? <option value="remint">{texts["award.remint"]}</option> : null}</select>
      <button type="submit" className="button primary">{texts["award.createBatch"]}</button></form>
    <h2>{texts["award.batches"]}</h2><ul>{batches.rows.map(batch => <li key={batch.id}><Link href={`/admin/awards/${award.id}/batches/${batch.id}`}>{texts[`award.${batch.kind as "regular" | "remint"}`]} · {texts[`award.${batch.status as "draft" | "finalized"}`]}</Link> · <LocalDateTime value={batch.created_at.toISOString()}/></li>)}</ul>
  </section></main>;
}
