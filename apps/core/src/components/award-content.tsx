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
    const keys = { saved: "award.saved", conflict: "award.conflict", invalid: "award.invalid", state: "award.state",
        notified: "award.notified", nothing: "award.nothingToNotify" } as const;
    if (!notice || !Object.hasOwn(keys, notice))
        return null;
    return <p role="status" className={["saved", "notified", "nothing"].includes(notice) ? "formNotice" : "formError"}>{texts[keys[notice as keyof typeof keys]]}</p>;
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
// The recipient's own instance: shared by the personal offer page and the public award page,
// so the accept/decline dialog is identical wherever the recipient opens it.
export function AwardInstancePanel({ instance, awarderName, texts }: {
    instance: AwardInstance;
    awarderName: string;
    texts: InterfaceTextValues;
}) {
    return <>
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
        <label><input type="checkbox" name="confirm" required/>{texts["award.rejectConfirm"]}</label><button type="submit" className="button secondary">{texts["award.reject"]}</button></form></details> : null}</>;
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
