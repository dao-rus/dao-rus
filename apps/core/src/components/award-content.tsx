import Link from "next/link";
import { UserText } from "./user-text";
import { AwardVisibilityForm } from "./award-instance-panel";
import { LocalDateTime } from "./local-date-time";
import type { Award, AwardInstance } from "../lib/awards";
import type { InterfaceTextValues } from "../lib/interface-texts";
export { AwardVisibilityForm, AwardInstancePanel } from "./award-instance-panel";
export function AwardContent({ award, texts }: {
    award: Award;
    texts: InterfaceTextValues;
}) {
    return <><div className="eyebrow"><Link href="/">ДАО Русь</Link></div><h1>{award.name}</h1>
    <img className="awardImage" src={award.imageUrl} alt={award.name} width={240} height={240}/>
    <p>{texts["award.establishedOn"]}: {award.establishedOn} · {texts[`award.${award.kind}`]}</p>
    {award.historicalCutoffAt ? <p>{texts["award.historicalCutoffAt"]}: <LocalDateTime value={award.historicalCutoffAt.toISOString()}/></p> : null}
    <h2>{texts["award.description"]}</h2><UserText text={award.description}/>
    <h2>{texts["award.criterion"]}</h2><UserText text={award.criterion}/>
    <h2>{texts["award.publicAddress"]}</h2><UserText text={award.publicAddress}/></>;
}
export function AwardNotice({ notice, texts }: {
    notice?: string;
    texts: InterfaceTextValues;
}) {
    const keys = { saved: "award.saved", conflict: "award.conflict", invalid: "award.invalid", state: "award.state",
        notified: "award.notified", nothing: "award.nothingToNotify" } as const;
    if (!notice || !Object.hasOwn(keys, notice))
        return null;
    return <p role="status" className={["saved", "notified", "nothing"].includes(notice) ? "formNotice" : "formError"}>{texts[keys[notice as keyof typeof keys]]}</p>;
}
export function OwnAwards({ offers, texts }: {
    offers: Array<{
        instance: AwardInstance;
        award: Award;
    }>;
    texts: InterfaceTextValues;
}) {
    return <section className="profileAbout"><h2>{texts["award.own"]}</h2>{offers.length ? offers.map(({ award, instance }) => <article key={instance.id}>
    <h3><Link href={`/award-offers/${instance.id}`}>{award.name}</Link></h3><p>{texts[`award.${instance.status}`]}</p>
    <AwardVisibilityForm instance={instance} texts={texts} profile/></article>) : <p className="muted">{texts["award.empty"]}</p>}</section>;
}
