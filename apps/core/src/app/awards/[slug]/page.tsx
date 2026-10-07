import { notFound } from "next/navigation";
import { getPublicAward } from "@/lib/award-views";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { AwardContent } from "@/components/award-content";
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
    const { values: texts } = await readInterfaceTexts();
    return <main className="shell"><section className="card"><AwardContent award={publicAward.award} texts={texts}/>
    <h2>{texts["award.recipients"]}</h2>{publicAward.recipients.length ? <ul>{publicAward.recipients.map(person => <li key={person.id}>{person.name}</li>)}</ul> : <p>{texts["award.empty"]}</p>}
  </section></main>;
}
