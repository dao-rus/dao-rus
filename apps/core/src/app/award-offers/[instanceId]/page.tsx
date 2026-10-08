import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { getOwnAwardOffers } from "@/lib/award-views";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { AwardValidationError, id } from "@/lib/awards";
import { AwardContent, AwardInstancePanel, AwardNotice } from "@/components/award-content";
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
    <AwardInstancePanel instance={instance} awarderName={awarderName} texts={texts}/>
    <p><Link href="/profile">{texts["award.own"]}</Link> · <Link href={`/awards/${award.slug}`}>{texts["award.publicPage"]}</Link></p>
  </section></main>;
}
