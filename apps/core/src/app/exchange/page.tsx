import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listBlindSignals, listRelayEncounters } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Нужно / есть" };

export default async function ExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const params = await searchParams;
  const kind = params.tab === "have" ? "have" : "need";
  const [signals, dialogs, { values: texts }] = await Promise.all([
    listBlindSignals(participant.id, kind),
    listRelayEncounters(participant.id, false),
    readInterfaceTexts(),
  ]);

  return (
    <main className="shell">
      <section className="card exchangePage">
        <div className="eyebrow">DAO Rus · Сеть</div>
        <h1>{texts["exchange.title"]}</h1>
        <p className="lead">{texts["exchange.lead"]}</p>
        <p className="muted">Сигналы опубликованы без имени автора. Не указывайте в тексте данные, по которым вас можно легко узнать.</p>
        <nav className="actions" aria-label="Разделы">
          <Link className={kind === "need" ? "button primary" : "button secondary"} href="/exchange?tab=need">Мне нужно</Link>
          <Link className={kind === "have" ? "button primary" : "button secondary"} href="/exchange?tab=have">У меня есть</Link>
          <Link className="button secondary" href="/relay">{texts["relay.list_title"]}{dialogs.length ? " (" + dialogs.length + ")" : ""}</Link>
        </nav>
        <div className="exchangeCards">
          {signals.length ? signals.map((signal) => (
            <article className="exchangeCard" key={signal.id}>
              <p>{signal.body}</p>
              {signal.mine ? (
                <span className="muted">Ваш сигнал</span>
              ) : (
                <form action="/api/relay" method="post">
                  <input type="hidden" name="action" value="respond" />
                  <input type="hidden" name="signal_id" value={signal.id} />
                  <button className="button primary" type="submit">Отозваться</button>
                </form>
              )}
            </article>
          )) : <p className="muted">{texts["exchange.empty"]}</p>}
        </div>
        <div className="actions">
          <Link className="button secondary" href={kind === "need" ? "/need" : "/profile"}>
            {kind === "need" ? "Добавить «Мне нужно»" : "Добавить «У меня есть»"}
          </Link>
          <Link className="button secondary" href="/profile">Мой профиль</Link>
        </div>
      </section>
    </main>
  );
}
