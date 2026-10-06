import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listRelayEncounters } from "@/lib/relay";
import { listNetworkSignals, listSignalTypes } from "../../lib/signals";
import { groupSignalTypes, selectSignalType, signalHref, signalTypePresentation } from "../../lib/signal-presentation";
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
        <p className="muted">{texts["exchange.privacy_hint"]}</p>
        <AngelSearch texts={texts} />
        <nav className="actions" aria-label="Разделы">
          {groupSignalTypes(types, texts).map((group) => <div key={group.key}>
            <h3>{group.name}</h3><div className="actions">{group.types.map((type) => (
              <Link key={type.key} className={selected?.key === type.key ? "button primary" : "button secondary"}
                href={`/exchange?type=${type.key}`} aria-current={selected?.key === type.key ? "page" : undefined}>
                {signalTypePresentation(type, texts).name}
              </Link>
            ))}</div></div>)}
          <Link className="button secondary" href="/relay">{texts["relay.list_title"]}{dialogs.length ? " (" + dialogs.length + ")" : ""}</Link>
        </nav>
        {presentation ? <><h2>{presentation.name}</h2><p className="muted">{presentation.description}</p>
          {presentation.example ? <p className="muted">{presentation.example}</p> : null}</> : null}
        <div className="exchangeCards">
          {signals.length ? signals.map((signal) => (
            <article className="exchangeCard" key={signal.id}>
              <strong><Link href={signalHref(signal.id)}>{signal.label}</Link></strong>
              {signal.description ? <p className="profileBio">{signal.description}</p> : null}
              {signal.author ? <Link href={`/profile/${signal.author.id}`}>{signal.author.name}</Link> : null}
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
