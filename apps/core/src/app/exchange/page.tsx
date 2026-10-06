import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listExchangeSignals, listRelayEncounters } from "@/lib/relay";
import { PROFILE_SIGNAL_KINDS, type LegacyProfileSignalKind } from "@/lib/profile-about";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Обмен" };

export default async function ExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const params = await searchParams;
  const kind: LegacyProfileSignalKind = PROFILE_SIGNAL_KINDS.includes(params.tab as LegacyProfileSignalKind)
    ? params.tab as LegacyProfileSignalKind : "need";
  const [signals, dialogs, { values: texts }] = await Promise.all([
    listExchangeSignals(participant.id, kind),
    listRelayEncounters(participant.id, false),
    readInterfaceTexts(),
  ]);

  return (
    <main className="shell">
      <section className="card exchangePage">
        <CoreNavigation current="exchange" texts={texts} />
        <div className="eyebrow">DAO Rus · Сеть</div>
        <h1>{texts["exchange.title"]}</h1>
        <p className="lead">{texts["exchange.lead"]}</p>
        <p className="muted">{texts["exchange.privacy_hint"]}</p>
        <nav className="actions" aria-label="Разделы">
          {(["need", "can", "want", "have"] as const).map((tab) => (
            <Link key={tab} className={kind === tab ? "button primary" : "button secondary"}
              href={`/exchange?tab=${tab}`} aria-current={kind === tab ? "page" : undefined}>
              {texts[`exchange.tab_${tab}`]}
            </Link>
          ))}
          <Link className="button secondary" href="/relay">{texts["relay.list_title"]}{dialogs.length ? " (" + dialogs.length + ")" : ""}</Link>
        </nav>
        <div className="exchangeCards">
          {signals.length ? signals.map((signal) => (
            <article className="exchangeCard" key={signal.id}>
              <p>{signal.body}</p>
              {signal.author ? <Link href={`/profile/${signal.author.id}`}>{signal.author.name}</Link> : null}
              {signal.mine ? (
                <span className="muted">Ваш сигнал</span>
              ) : signal.anonymous ? (
                <form action="/api/relay" method="post">
                  <input type="hidden" name="action" value="respond" />
                  <input type="hidden" name="signal_id" value={signal.id} />
                  <button className="button primary" type="submit">Отозваться</button>
                </form>
              ) : null}
            </article>
          )) : <p className="muted">{texts["exchange.empty"]}</p>}
        </div>
        <div className="actions">
          <Link className="button secondary" href={kind === "need" ? "/need" : `/profile#signal-${kind}`}>
            {texts[`exchange.add_${kind}`]}
          </Link>
          <Link className="button secondary" href="/profile">Мой профиль</Link>
        </div>
      </section>
    </main>
  );
}
