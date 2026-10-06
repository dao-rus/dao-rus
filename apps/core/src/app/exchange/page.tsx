import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listRelayEncounters } from "@/lib/relay";
import { listNetworkSignals, listSignalTypes } from "../../lib/signals";
import { selectSignalType, signalHref, signalTypePresentation } from "../../lib/signal-presentation";
import { AngelSearch } from "../../components/angel-search";

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
  const types = catalog.filter((type) => type.enabled);
  const selected = selectSignalType(types, params.type ?? params.tab);
  const signals = selected ? await listNetworkSignals(participant.id, selected.key) : [];
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
            return <Link key={type.key} className={selected?.key === type.key ? "button primary" : "button secondary"}
              href={`/exchange?type=${type.key}`} aria-current={selected?.key === type.key ? "page" : undefined}>
              <span className="exchangeTypeSymbol" aria-hidden="true">{item.symbol}</span>{item.navigationName}
            </Link>;
          })}
        </nav>
        <div className="exchangeUtility"><Link href="/relay">{texts["relay.list_title"]}{dialogs.length ? ` (${dialogs.length})` : ""}</Link></div>
        {presentation ? <div className="exchangeSelection"><h2>{presentation.navigationName}</h2><p className="muted">{presentation.description}</p>
          {presentation.example ? <p className="muted">{presentation.example}</p> : null}</div> : null}
        {signals.some((signal) => signal.visibility === "network_blind") ? <p className="muted exchangeBlindHint">{texts["exchange.privacy_hint"]}</p> : null}
        <div className="exchangeCards">
          {signals.length ? signals.map((signal) => (
            <article className="exchangeCard" key={signal.id}>
              <strong className="exchangeCardTitle"><Link href={signalHref(signal.id)}>{signal.label}</Link></strong>
              {signal.description ? <p className="profileBio">{signal.description}</p> : null}
              {signal.author && signal.visibility !== "network_blind" ? <div className="exchangeCardAuthor"><Link href={`/profile/${signal.author.id}`}>{signal.author.name}</Link></div> : null}
              {signal.mine ? (
                <span className="muted">{texts["signal.mine"]}</span>
              ) : signal.visibility === "network_blind" && (selected?.key === "need" || selected?.key === "have") ? (
                <form action="/api/relay" method="post">
                  <input type="hidden" name="action" value="respond" />
                  <input type="hidden" name="signal_id" value={signal.id} />
                  <button className="button primary" type="submit">{texts["signal.respond"]}</button>
                </form>
              ) : null}
            </article>
          )) : <p className="muted">{texts["exchange.empty"]}</p>}
        </div>
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
