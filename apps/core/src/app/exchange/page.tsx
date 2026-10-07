import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listRelayEncounters } from "@/lib/relay";
import { listNetworkSignals, listParticipantSignals, listSignalTypes } from "../../lib/signals";
import { orderSignalTypes, selectSignalType, signalHref, signalTypePresentation } from "../../lib/signal-presentation";
import { AngelSearch } from "../../components/angel-search";
import { UserText } from "../../components/user-text";
import { SignalPreview } from "../../components/signal-preview";
import { SignalTypeIcon } from "../../components/signal-type-icon";
import { listCloserGoals, listCloserMatches, listOwnCloserKeys } from "../../lib/closer";
import { ExchangeTypeNavScroll } from "../../components/exchange-type-nav-scroll";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Обмен" };

export default async function ExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; tab?: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const params = await searchParams;
  const [catalog, dialogs, { values: texts }] = await Promise.all([
    listSignalTypes(), listRelayEncounters(participant.id, false), readInterfaceTexts(),
  ]);
  const types = orderSignalTypes(catalog.filter((type) => type.enabled));
  const selected = selectSignalType(types, params.type ?? params.tab);
  // «Ближе» is never a public listing: the tab explains the mechanics and shows only the viewer's own records.
  const closer = selected?.key === "dating";
  const signals = selected && !closer ? await listNetworkSignals(participant.id, selected.key) : [];
  const ownCloser = closer ? (await listParticipantSignals(participant.id, participant.id))
    .filter((signal) => signal.typeKey === "dating") : [];
  const [closerKeys, closerGoals, matches] = closer ? await Promise.all([
    listOwnCloserKeys(participant.id), listCloserGoals(), listCloserMatches(participant.id)]) : [new Map(), [], []];
  const ownCloserMeta = (signal: (typeof ownCloser)[number]) => {
    const keys = closerKeys.get(signal.id);
    if (!keys) return texts["closer.no_keys"];
    if (signal.visibility !== "match_only") return texts["closer.draft"];
    return closerGoals.find((goal) => goal.key === keys.goalKey)?.displayName;
  };
  const presentation = selected ? signalTypePresentation(selected, texts) : null;

  return (
    <main className="shell">
      <section className="card exchangePage">
        <CoreNavigation current="exchange" texts={texts} />
        <div className="eyebrow">DAO Rus · Сеть</div>
        <h1>{texts["exchange.title"]}</h1>
        <p className="lead">{texts["exchange.lead"]}</p>
        <AngelSearch texts={texts} />
        <nav className="exchangeTypeNav" aria-label="Типы сигналов">
          {types.map((type) => {
            const item = signalTypePresentation(type, texts);
            return <Link key={type.key} className="exchangeTypeTab" href={`/exchange?type=${type.key}`}
              aria-current={selected?.key === type.key ? "page" : undefined}>
              <SignalTypeIcon typeKey={type.key} /><span>{item.navigationName}</span>
            </Link>;
          })}
        </nav>
        <ExchangeTypeNavScroll current={selected?.key} />
        <div className="exchangeUtility"><Link href="/relay">{texts["relay.list_title"]}{dialogs.length ? ` (${dialogs.length})` : ""}</Link></div>
        {presentation ? <div className="exchangeSelection"><h2>{presentation.navigationName}</h2><p className="muted">{presentation.description}</p>
          {presentation.example ? <p className="muted">{presentation.example}</p> : null}</div> : null}
        {closer ? <div className="exchangeCloser">
          <p className="exchangeCloserIntro">{texts["exchange.closer_intro"]}</p>
          {ownCloser.length ? <><h3>{texts["exchange.closer_own_title"]}</h3>
            <div className="exchangeCards">
              {ownCloser.map((signal) => <SignalPreview key={signal.id} href={signalHref(signal.id)} label={signal.label}
                description={signal.description} meta={ownCloserMeta(signal)} />)}
            </div></> : null}
          <h3>{texts["closer.matches_title"]}</h3>
          {/* A match carries no author and is not a link: the record itself stays unreachable by URL. */}
          <div className="exchangeCards">
            {matches.length ? matches.map((match) => <article className="exchangeCard" key={match.signalId}>
              <div className="signalPreviewKicker">{match.goalName} · {match.city ?? texts["closer.city_any"]}</div>
              <strong className="exchangeCardTitle"><UserText inline text={match.label} /></strong>
              {match.description ? <UserText text={match.description} /> : null}
              {match.encounterId ? <p><Link className="button secondary" href={`/relay/${match.encounterId}`}>{texts["closer.continue_dialog"]}</Link></p>
                : <form action="/api/relay" method="post">
                  <input type="hidden" name="action" value="closer_respond" />
                  <input type="hidden" name="my_signal_id" value={match.mySignalId} />
                  <input type="hidden" name="signal_id" value={match.signalId} />
                  <button className="button primary" type="submit">{texts["closer.open_dialog"]}</button>
                </form>}
            </article>) : <p className="muted">{texts["closer.matches_empty"]}</p>}
          </div>
        </div> : <>
          {signals.some((signal) => signal.visibility === "network_blind") ? <p className="muted exchangeBlindHint">{texts["exchange.privacy_hint"]}</p> : null}
          <div className="exchangeCards">
            {signals.length ? signals.map((signal) => (
              <SignalPreview key={signal.id} href={signalHref(signal.id)} label={signal.label}
                description={signal.description}
                author={signal.author && signal.visibility !== "network_blind" ? signal.author.name : null}>
                {signal.mine ? (
                  <span className="muted">{texts["signal.mine"]}</span>
                ) : signal.visibility === "network_blind" && (selected?.key === "need" || selected?.key === "have") ? (
                  <form action="/api/relay" method="post">
                    <input type="hidden" name="action" value="respond" />
                    <input type="hidden" name="signal_id" value={signal.id} />
                    <button className="button primary" type="submit">{texts["signal.respond"]}</button>
                  </form>
                ) : null}
              </SignalPreview>
            )) : <p className="muted">{texts["exchange.empty"]}</p>}
          </div>
        </>}
        <div className="actions">
          {selected && presentation ? <Link className="button secondary" href={`/exchange/new?type=${selected.key}`}>
            {presentation.cta}
          </Link> : null}
          <Link className="button secondary" href="/profile">{texts["signal.profile_link"]}</Link>
        </div>
      </section>
    </main>
  );
}
