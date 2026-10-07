import Link from "next/link";
import { requireAwardAdmin } from "@/lib/award-admin";
import { pool } from "@/lib/db";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { AwardNotice } from "@/components/award-content";
export const dynamic = "force-dynamic";
export const metadata = { title: "Награды · Учредитель" };
export default async function AwardsAdminPage({ searchParams }: {
    searchParams: Promise<{
        award_update?: string;
    }>;
}) {
    await requireAwardAdmin();
    const [result, { values: texts }, query] = await Promise.all([pool.query("SELECT id,name,slug,kind,established_on::text FROM awards ORDER BY created_at DESC"), readInterfaceTexts(), searchParams]);
    return <main className="shell"><section className="card"><h1>{texts["award.registry"]}</h1>
    <AwardNotice notice={query.award_update} texts={texts}/>
    {result.rows.length ? <ul>{result.rows.map(row => <li key={row.id}><Link href={`/admin/awards/${row.id}`}>{row.name}</Link> · {row.established_on} · {texts[`award.${row.kind as "historical" | "open"}`]}</li>)}</ul> : <p>{texts["award.empty"]}</p>}
    <h2>{texts["award.establish"]}</h2><form className="awardForm" action="/api/admin/awards" method="post" encType="multipart/form-data">
      <label>{texts["award.name"]}<input name="name" maxLength={200} required/></label>
      <label>{texts["award.slug"]}<input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} required/></label>
      <label>{texts["award.image"]}<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required/></label>
      <label>{texts["award.establishedOn"]}<input name="establishedOn" type="date" required/></label>
      {(["description", "criterion", "publicAddress"] as const).map(key => <label key={key}>{texts[`award.${key}`]}<textarea name={key} maxLength={10000} rows={4} required/></label>)}
      <label>{texts["award.kind"]}<select name="kind"><option value="historical">{texts["award.historical"]}</option><option value="open">{texts["award.open"]}</option></select></label>
      <label>{texts["award.historicalCutoffAt"]}<input name="historicalCutoffAt" placeholder="2024-09-22T00:00:00+03:00"/></label>
      <button type="submit" className="button primary">{texts["award.establish"]}</button></form>
    <Link href="/profile">{texts["award.own"]}</Link>
  </section></main>;
}
