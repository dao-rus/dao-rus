import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CoreNavigation } from "../../../components/core-navigation";
import { SignalShareAction } from "../../../components/signal-share-action";
import { appBaseUrl } from "../../../lib/config";
import { readInterfaceTexts, type InterfaceTextValues } from "../../../lib/interface-texts";
import { readSignalReactionState } from "../../../lib/signal-reactions";
import { getCurrentParticipant } from "../../../lib/session";
import { getGuestShareableSignal, getSignal, listSignalTypes } from "../../../lib/signals";
import { signalHref, signalTypePresentation } from "../../../lib/signal-presentation";

export const dynamic = "force-dynamic";

type CardProps = { params: Promise<{ signalId: string }> };

function CardBody({ type, label, description, author }: {
  type: string; label: string; description: string | null; author: ReactNode;
}) {
  return <div className="signalCardBody">
    <div className="signalCardType">{type}</div>
    <h1 className="signalCardLabel">{label}</h1>
    {description ? <p className="signalCardDescription">{description}</p> : null}
    {author}
  </div>;
}

function Share({ id, label, texts }: { id: string; label: string; texts: InterfaceTextValues }) {
  return <SignalShareAction
    payload={{ title: label, text: texts["signal.share_text"], url: new URL(signalHref(id), appBaseUrl()).toString() }}
    labels={{ share: texts["signal.share"], telegram: texts["signal.share_telegram"],
      vk: texts["signal.share_vk"], email: texts["signal.share_email"], copy: texts["signal.share_copy"],
      copied: texts["signal.share_copied"], failed: texts["signal.share_failed"] }} />;
}

export async function generateMetadata({ params }: CardProps): Promise<Metadata> {
  const { signalId } = await params;
  const guestSignal = await getGuestShareableSignal(signalId);
  const { values: texts } = await readInterfaceTexts();
  const robots = { index: false, follow: false };
  if (!guestSignal) return { title: texts["signal.card_title"], robots };
  const types = await listSignalTypes();
  const type = types.find((entry) => entry.key === guestSignal.typeKey);
  const typeName = type ? signalTypePresentation(type, texts).name : texts["signal.card_title"];
  const title = `${typeName}: ${guestSignal.label.slice(0, 120)}`;
  return { title, robots, openGraph: {
    title, description: texts["signal.external_context"],
    url: new URL(signalHref(guestSignal.id), appBaseUrl()).toString(), type: "article",
  } };
}

export default async function SignalPage({ params }: CardProps) {
  const { signalId } = await params;
  const viewer = await getCurrentParticipant();
  if (!viewer) {
    const guest = await getGuestShareableSignal(signalId);
    if (!guest) notFound();
    const [types, { values: texts }] = await Promise.all([listSignalTypes(), readInterfaceTexts()]);
    const type = types.find((entry) => entry.key === guest.typeKey);
    if (!type) notFound();
    const typeName = signalTypePresentation(type, texts).name;
    return <main className="shell"><article className="card signalCard signalGuestCard">
      <header className="signalGuestHeader"><Link href="/">{texts["signal.external_brand"]}</Link></header>
      <CardBody type={typeName} label={guest.label} description={guest.description}
        author={<p className="signalCardAuthor">{guest.authorName}</p>} />
      <p className="signalCardContext">{texts["signal.external_context"]}</p>
      <p className="signalCardGuestHint">{texts["signal.auth_required"]}</p>
      <div className="signalActionBar"><Share id={guest.id} label={guest.label} texts={texts} />
        <Link className="button secondary" href="/">{texts["signal.open_core"]}</Link></div>
    </article></main>;
  }

  const signal = await getSignal(viewer.id, signalId);
  if (!signal) notFound();
  const [types, { values: texts }, reaction] = await Promise.all([
    listSignalTypes(), readInterfaceTexts(), readSignalReactionState(signal.id, viewer.id),
  ]);
  const type = types.find((entry) => entry.key === signal.typeKey);
  if (!type) notFound();
  const author = signal.visibility === "network_blind" ? null : signal.author;
  const shareable = signal.status === "active" && signal.visibility === "public" && signal.externalShareEnabled;
  const respondBlind = !signal.mine && signal.status === "active" && signal.visibility === "network_blind"
    && (signal.typeKey === "need" || signal.typeKey === "have");

  return <main className="shell"><article className="card signalCard">
    <CoreNavigation current="exchange" texts={texts} />
    <CardBody type={signalTypePresentation(type, texts).name} label={signal.label}
      description={signal.description} author={author ? <p className="signalCardAuthor">
        <Link href={`/profile/${author.id}`}>{author.name}</Link></p> : null} />
    {signal.mine ? <p className="muted signalCardState">
      {texts[`signal.visibility_${signal.visibility}`]} · {texts[`signal.status_${signal.status}`]}
    </p> : null}
    <div className="signalActionBar">
      {(signal.mine && signal.status === "active") || respondBlind || (!signal.mine && author) ? <div className="signalActionGroup">
      {signal.mine && signal.status === "active" ? <>
        <Link className="button secondary" href={`/exchange/new?signal=${signal.id}`}>
          {texts[signal.legacyBody ? "signal.refine" : "signal.edit"]}
        </Link>
        <form action="/api/profile/about" method="post">
          <input type="hidden" name="action" value="archive_signal" />
          <input type="hidden" name="signal_id" value={signal.id} />
          <button className="button secondary" type="submit">{texts["signal.archive"]}</button>
        </form>
      </> : null}
      {respondBlind ? <form action="/api/relay" method="post">
        <input type="hidden" name="action" value="respond" />
        <input type="hidden" name="signal_id" value={signal.id} />
        <button className="button primary" type="submit">{texts["signal.card_respond"]}</button>
      </form> : null}
      {!signal.mine && author ? <Link className="button secondary" href={`/profile/${author.id}`}>
        {texts["signal.owner_profile"]}</Link> : null}
      </div> : null}
      {!signal.mine && signal.status === "active" ? <div className="signalActionGroup">
      <form action="/api/signals/card" method="post">
        <input type="hidden" name="signal_id" value={signal.id} />
        <input type="hidden" name="action" value={reaction.reacted ? "react_remove" : "react_add"} />
        <button className="button secondary" type="submit" aria-pressed={reaction.reacted}
          title={reaction.reacted ? texts["signal.reaction_remove"] : undefined}>
          {texts["signal.reaction_useful"]} · {reaction.count}</button>
      </form>
      </div> : null}
      {signal.status === "active" ? <div className="signalActionGroup">
      {shareable ? <Share id={signal.id} label={signal.label} texts={texts} />
        : <span className="signalUnavailable" title={texts["signal.share_unavailable"]}>
          {texts["signal.share_unavailable"]}</span>}
      </div> : null}
    </div>
    {signal.mine && signal.status === "active" && signal.visibility === "public" ?
      <details className="signalSharePolicy"><summary>{texts[signal.externalShareEnabled ? "signal.external_disable" : "signal.external_enable"]}</summary>
        <form action="/api/signals/card" method="post">
          <input type="hidden" name="signal_id" value={signal.id} />
          <input type="hidden" name="action" value={signal.externalShareEnabled ? "share_disable" : "share_enable"} />
          {!signal.externalShareEnabled ? <label><input type="checkbox" name="confirm_external_share" value="yes" required />
            {texts["signal.external_consent"]}</label> : null}
          <button className="button secondary" type="submit">
            {texts[signal.externalShareEnabled ? "signal.external_disable" : "signal.external_enable"]}</button>
        </form>
      </details> : null}
    <Link className="signalBackLink" href="/exchange">{texts["signal.back_exchange"]}</Link>
  </article></main>;
}
