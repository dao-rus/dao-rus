import { notFound } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { getOwnAwardOffers, getPublicAward } from "@/lib/award-views";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { AwardContent, AwardInstancePanel } from "@/components/award-content";
export const dynamic = "force-dynamic";
export const metadata = { title: "Награда ДАО Русь" };
export default async function PublicAwardPage({ params }: {
    params: Promise<{
        slug: string;
    }>;
}) {
    const { slug } = await params;
    const publicAward = await getPublicAward(slug);
    if (!publicAward)
        notFound();
    const [{ values: texts }, actor] = await Promise.all([readInterfaceTexts(), getCurrentParticipant()]);
    // The link is shared by everyone, so the visitor's own session decides what is shown.
    // Only the viewer's own instance is ever selected; a visitor without one sees nothing extra,
    // which also hides who else was or was not offered the award.
    const own = actor ? (await getOwnAwardOffers(actor.id)).find(offer => offer.award.id === publicAward.award.id) : undefined;
    return <main className="shell"><section className="card"><AwardContent award={publicAward.award} texts={texts}/>
    {own ? <section aria-labelledby="award-own-offer"><h2 id="award-own-offer">{texts["award.ownOffer"]}</h2>
      <AwardInstancePanel instance={own.instance} awarderName={own.awarderName} texts={texts}/></section> : null}
    {!actor ? <p><a className="button secondary" href={`/api/auth/telegram/start?next=${encodeURIComponent(`/awards/${publicAward.award.slug}`)}`}>{texts["award.loginIfOffered"]}</a></p> : null}
    <h2>{texts["award.recipients"]}</h2>{publicAward.recipients.length ? <ul>{publicAward.recipients.map(person => <li key={person.id}>{person.name}</li>)}</ul> : <p>{texts["award.empty"]}</p>}
  </section></main>;
}
