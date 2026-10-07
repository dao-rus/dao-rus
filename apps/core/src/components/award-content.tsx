import Link from "next/link";
import { UserText } from "./user-text";
import { LocalDateTime } from "./local-date-time";
import type { Award, AwardInstance } from "../lib/awards";
import type { InterfaceTextValues } from "../lib/interface-texts";
export function AwardContent({ award, texts }: {
    award: Award;
    texts: InterfaceTextValues;
}) {
    return <><div className="eyebrow">ДАО Русь</div><h1>{award.name}</h1>
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
    if (!notice || !["saved", "conflict", "invalid", "state"].includes(notice))
        return null;
    return <p role="status" className={notice === "saved" ? "formNotice" : "formError"}>{texts[`award.${notice as "saved" | "conflict" | "invalid" | "state"}`]}</p>;
}
export function AwardVisibilityForm({ instance, texts, profile = false }: {
    instance: AwardInstance;
    texts: InterfaceTextValues;
    profile?: boolean;
}) {
    if (instance.status !== "accepted")
        return null;
    return <form action="/api/awards/instances" method="post" className="awardForm">
    <input type="hidden" name="instanceId" value={instance.id}/><input type="hidden" name="action" value="visibility"/>
    {profile ? <input type="hidden" name="returnTo" value="profile"/> : null}
    <label><input type="checkbox" name="showInPublicList" defaultChecked={instance.showInPublicList}/>{texts["award.showInPublicList"]}</label>
    <label><input type="checkbox" name="showNextToName" defaultChecked={instance.showNextToName}/>{texts["award.showNextToName"]}</label>
    <button type="submit" className="button secondary">{texts["award.save"]}</button></form>;
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
