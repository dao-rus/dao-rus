import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { getOwnAwardOffers } from "@/lib/award-views";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { AwardValidationError, id } from "@/lib/awards";
import { AwardContent, AwardNotice, AwardVisibilityForm } from "@/components/award-content";
import { UserText } from "@/components/user-text";
import { LocalDateTime } from "@/components/local-date-time";
export const dynamic = "force-dynamic";
export const metadata = { title: "Предложение награды", robots: { index: false, follow: false } };
export default async function AwardOfferPage({ params, searchParams }: {
    params: Promise<{
        instanceId: string;
    }>;
    searchParams: Promise<{
        award_update?: string;
    }>;
}) {
    const { instanceId } = await params;
    try {
        id(instanceId);
    }
    catch (error) {
        if (error instanceof AwardValidationError)
            notFound();
        throw error;
    }
    const actor = await getCurrentParticipant();
    const { values: texts } = await readInterfaceTexts();
    if (!actor)
        return <main className="shell"><section className="card"><Link className="button primary" href={`/api/auth/telegram/start?next=${encodeURIComponent(`/award-offers/${instanceId}`)}`}>{texts["award.login"]}</Link></section></main>;
    const offer = (await getOwnAwardOffers(actor.id, instanceId))[0];
    if (!offer)
        notFound();
    const { award, instance, awarderName } = offer;
    const query = await searchParams;
    return <main className="shell"><section className="card">
    <AwardNotice notice={query.award_update} texts={texts}/><AwardContent award={award} texts={texts}/>
    <p>{texts[`award.${instance.status}`]}</p><p>{texts["award.awarder"]}: {awarderName}</p>
    <h2>{texts["award.reason"]}</h2><UserText text={instance.reason}/>
    {instance.personalAddress ? <><h2>{texts["award.personalAddress"]}</h2><UserText text={instance.personalAddress}/></> : null}
    {(["offeredAt", "declinedAt", "acceptedAt", "rejectedAt"] as const).map(key => instance[key] ? <p key={key}>{texts[`award.${key}`]}: <LocalDateTime value={instance[key]!.toISOString()}/></p> : null)}
    {instance.status === "offered" || instance.status === "declined" ? <form action="/api/awards/instances" method="post" className="actions">
      <input type="hidden" name="instanceId" value={instance.id}/><button className="button primary" name="action" value="accept">{texts["award.accept"]}</button>
      {instance.status === "offered" ? <button className="button secondary" name="action" value="decline">{texts["award.decline"]}</button> : null}</form> : null}
    <AwardVisibilityForm instance={instance} texts={texts}/>
    {instance.status === "accepted" ? <details><summary>{texts["award.reject"]}</summary><p>{texts["award.rejectWarning"]}</p>
      <form action="/api/awards/instances" method="post"><input type="hidden" name="instanceId" value={instance.id}/><input type="hidden" name="action" value="reject"/>
        <label><input type="checkbox" name="confirm" required/>{texts["award.rejectConfirm"]}</label><button type="submit" className="button secondary">{texts["award.reject"]}</button></form></details> : null}
    <p><Link href="/profile">{texts["award.own"]}</Link> · <Link href={`/awards/${award.slug}`}>{texts["award.publicPage"]}</Link></p>
  </section></main>;
}
