import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listRelayEncounters } from "@/lib/relay";
import { CoreNavigation } from "../../components/core-navigation";
import { UserText } from "../../components/user-text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Диалоги" };

export default async function RelayListPage({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const archive = (await searchParams).archive === "1";
  const [encounters, { values: texts }] = await Promise.all([
    listRelayEncounters(participant.id, archive),
    readInterfaceTexts(),
  ]);

  return (
    <main className="shell">
      <section className="card exchangePage">
        <CoreNavigation current="exchange" texts={texts} />
        <div className="eyebrow">DAO Rus · Нужно / есть</div>
        <h1>{archive ? texts["relay.archive_title"] : texts["relay.list_title"]}</h1>
        <nav className="actions" aria-label="Диалоги">
          <Link className={!archive ? "button primary" : "button secondary"} href="/relay">Активные</Link>
          <Link className={archive ? "button primary" : "button secondary"} href="/relay?archive=1">Архив</Link>
          <Link className="button secondary" href="/exchange">{texts["exchange.title"]}</Link>
        </nav>
        <div className="exchangeCards">
          {encounters.length ? encounters.map((encounter) => (
            <article className="exchangeCard" key={encounter.id}>
              <UserText text={encounter.body} />
              <p className="muted">
                {encounter.role === "author" ? "Автор сигнала" : "Откликнувшийся"}
                {" · "}
                {encounter.status === "revealed" ? "Контакт открыт"
                  : encounter.status === "cancelled" ? "Отменён" : "Анонимный диалог"}
              </p>
              <Link className="button secondary" href={"/relay/" + encounter.id}>Открыть диалог</Link>
            </article>
          )) : <p className="muted">{archive ? texts["relay.archive_empty"] : texts["relay.list_empty"]}</p>}
        </div>
      </section>
    </main>
  );
}
