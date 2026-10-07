import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CoreNavigation } from "../../../components/core-navigation";
import { SignalShareAction } from "../../../components/signal-share-action";
import { appBaseUrl } from "../../../lib/config";
import { readInterfaceTexts, type InterfaceTextValues } from "../../../lib/interface-texts";
import { readPublicSignalReactionCount, readSignalReactionState } from "../../../lib/signal-reactions";
import { getCurrentParticipant } from "../../../lib/session";
import { getGuestShareableSignal, getSignal, isSignalHidden, listSignalTypes, readSignalViews } from "../../../lib/signals";
import { SignalViewBeacon } from "../../../components/signal-view-beacon";
import { signalAudience, signalHref, signalTypePresentation } from "../../../lib/signal-presentation";
import { UserText } from "../../../components/user-text";

export const dynamic = "force-dynamic";

type CardProps = { params: Promise<{ signalId: string }>; searchParams?: Promise<{ discussion?: string }> };

function CardBody({ type, label, description, author }: {
  type: string; label: string; description: string | null; author: ReactNode;
}) {
  return <div className="signalCardBody">
    <div className="signalCardType">{type}</div>
    <h1 className="signalCardLabel"><UserText inline text={label} /></h1>
    {description ? <UserText className="signalCardDescription" text={description} /> : null}
    {author}
  </div>;
}

function Share({ id, label, description, texts, copyOnly }: {
  id: string; label: string; description: string | null; texts: InterfaceTextValues; copyOnly?: boolean;
}) {
  return <SignalShareAction copyOnly={copyOnly}
    payload={{ label, description, url: new URL(signalHref(id), appBaseUrl()).toString() }}
    labels={{ share: texts["signal.share"], telegram: texts["signal.share_telegram"],
      vk: texts["signal.share_vk"], ok: texts["signal.share_ok"],
      whatsapp: texts["signal.share_whatsapp"], more: texts["signal.share_more"], email: texts["signal.share_email"], copy: texts["signal.share_copy"],
      copied: texts["signal.share_copied"], failed: texts["signal.share_failed"] }} />;
}

// The button exists only where a discussion can actually be opened: feature on, topic set, record named and open.
async function discussionState(signal: { id: string; typeKey: string; visibility: Parameters<typeof signalAudience>[0]; status: string }) {
  const { discussionEligible, discussionTopic, readDiscussionLinkWithDatabase } = await import("../../../lib/signal-discussion");
  if (!discussionEligible(signal)) return null;
  const [{ readGuardianSettings, forumInternalId }, { telegramBotToken, telegramReceptionConfig }, { pool }] = await Promise.all([
    import("../../../lib/guardian-forum"), import("../../../lib/config"), import("../../../lib/db")]);
  const forumChatId = telegramReceptionConfig().forumChatId;
  if (!telegramBotToken() || !forumInternalId(forumChatId)) return null;
  if (!discussionTopic(await readGuardianSettings(), signal.typeKey)) return null;
  return { link: await readDiscussionLinkWithDatabase(pool, signal.id, forumChatId) };
}

export async function generateMetadata({ params }: CardProps): Promise<Metadata> {
  const { signalId } = await params;
  const guestSignal = await getGuestShareableSignal(signalId);
  const { values: texts } = await readInterfaceTexts();
  const robots = { index: false, follow: false };
  if (!guestSignal) return { title: texts["signal.card_title"], robots };
  const title = guestSignal.label.slice(0, 120);
  return { title, robots, openGraph: {
    title, url: new URL(signalHref(guestSignal.id), appBaseUrl()).toString(), type: "article",
  } };
}

export default async function SignalPage({ params, searchParams }: CardProps) {
  const { signalId } = await params;
  const viewer = await getCurrentParticipant();
  if (!viewer) {
    const guest = await getGuestShareableSignal(signalId);
    if (!guest) notFound();
    const [{ values: texts }, likes, views] = await Promise.all([readInterfaceTexts(), readPublicSignalReactionCount(guest.id), readSignalViews(guest.id)]);
    // A like click is the sign-in moment: standard Telegram auth, back to this canonical card.
    const likeHref = `/api/auth/telegram/start?next=${encodeURIComponent(signalHref(guest.id))}`;
    return <main className="shell"><article className="signalGuestCard">
      <header className="signalGuestHeader"><Link href="/">{texts["signal.external_brand"]}</Link></header>
      <h1 className="signalCardLabel"><UserText inline text={guest.label} /></h1>
      {guest.description ? <UserText className="signalCardDescription" text={guest.description} /> : null}
      <p className="signalCardAuthor">{guest.authorName}</p>
      <a className="signalGuestLike" href={likeHref} aria-label={texts["signal.reaction_like"]}>♥ {likes}</a>
      <p className="signalCardViews">{texts["signal.views"]}: {views}</p>
      <SignalViewBeacon signalId={guest.id} />
      <div className="signalGuestShare"><Share id={guest.id} label={guest.label} description={guest.description} texts={texts} /></div>
    </article></main>;
  }

  const signal = await getSignal(viewer.id, signalId);
  if (!signal) notFound();
  const [types, { values: texts }, reaction, views, hiddenByViewer] = await Promise.all([
    listSignalTypes(), readInterfaceTexts(), readSignalReactionState(signal.id, viewer.id),
    readSignalViews(signal.id), isSignalHidden(viewer.id, signal.id),
  ]);
  const type = types.find((entry) => entry.key === signal.typeKey);
  if (!type) notFound();
  const author = signal.visibility === "network_blind" ? null : signal.author;
  const active = signal.status === "active";
  // Share only links others can open: public (guests), members, or blind (members, via Relay).
  const shareable = active && ["public", "members", "network_blind"].includes(signal.visibility);
  const audience = signalAudience(signal.visibility);
  // A card must open even if the forum settings cannot be read; it then simply has no discussion button.
  const discussion = await discussionState(signal).catch(() => null);
  const discussionNotice = (await searchParams)?.discussion;
  const respondBlind = !signal.mine && active && signal.visibility === "network_blind"
    && (signal.typeKey === "need" || signal.typeKey === "have");

  return <main className="shell"><article className="card signalCard">
    <CoreNavigation current="exchange" texts={texts} />
    <CardBody type={signalTypePresentation(type, texts).name} label={signal.label}
      description={signal.description} author={author ? <p className="signalCardAuthor">{author.name}</p> : null} />
    {signal.mine ? <p className="muted signalCardState">
      {texts[`signal.visibility_${signal.visibility}`]} · {texts[`signal.status_${signal.status}`]}
    </p> : null}
    <p className="signalCardViews">{!signal.mine && audience ? `${texts[`signal.audience_${audience}`]} · ` : ""}{texts["signal.views"]}: {views}</p>
    {hiddenByViewer ? <p className="muted">{texts["signal.hidden_note"]}</p> : null}
    {!signal.mine && active ? <SignalViewBeacon signalId={signal.id} /> : null}
    {discussionNotice === "pending" || discussionNotice === "failed"
      ? <p className={discussionNotice === "failed" ? "formError" : "formNotice"} role="status">{texts[`signal.discuss_${discussionNotice}`]}</p> : null}
    {active ? <div className="signalActionBar">
      {signal.mine ? <>
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
      {!signal.mine ? <form action="/api/signals/card" method="post">
        <input type="hidden" name="signal_id" value={signal.id} />
        <input type="hidden" name="action" value={reaction.reacted ? "react_remove" : "react_add"} />
        <button className="button secondary" type="submit" aria-pressed={reaction.reacted}
          aria-label={texts["signal.reaction_like"]}
          title={reaction.reacted ? texts["signal.reaction_remove"] : texts["signal.reaction_like"]}>
          ♥ {reaction.count}</button>
      </form> : null}
      {discussion?.link ? <a className="button secondary" href={discussion.link}>{texts["signal.discuss"]}</a>
        : discussion ? <form action="/api/signals/card" method="post">
          <input type="hidden" name="signal_id" value={signal.id} />
          <input type="hidden" name="action" value="discuss" />
          <button className="button secondary" type="submit">{texts["signal.discuss"]}</button>
        </form> : null}
      {!signal.mine ? <form action="/api/signals/card" method="post">
        <input type="hidden" name="signal_id" value={signal.id} />
        <input type="hidden" name="action" value={hiddenByViewer ? "unhide" : "hide"} />
        <button className="button secondary" type="submit">{texts[hiddenByViewer ? "signal.unhide" : "signal.hide"]}</button>
      </form> : null}
      {shareable ? <Share id={signal.id} label={signal.label} description={signal.description} texts={texts}
        copyOnly={audience !== "public"} /> : null}
    </div> : null}
    <Link className="signalBackLink" href="/exchange">{texts["signal.back_exchange"]}</Link>
  </article></main>;
}
