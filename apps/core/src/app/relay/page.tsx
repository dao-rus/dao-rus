import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { listRelayEncounters } from "@/lib/relay";

export const dynamic = "force-dynamic";

export default async function RelayListPage({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const archive = (await searchParams).archive === "1";
  const encounters = await listRelayEncounters(participant.id, archive);

  return (
    <main className="shell">
      <section className="card exchangePage">
        <div className="eyebrow">DAO Rus · Нужно / есть</div>
        <h1>{archive ? "Архив диалогов" : "Диалоги"}</h1>
        <nav className="actions" aria-label="Диалоги">
          <Link className={!archive ? "button primary" : "button secondary"} href="/relay">Активные</Link>
          <Link className={archive ? "button primary" : "button secondary"} href="/relay?archive=1">Архив</Link>
          <Link className="button secondary" href="/exchange">Нужно / есть</Link>
        </nav>
        <div className="exchangeCards">
          {encounters.length ? encounters.map((encounter) => (
            <article className="exchangeCard" key={encounter.id}>
              <p>{encounter.body}</p>
              <p className="muted">
                {encounter.role === "author" ? "Автор сигнала" : "Откликнувшийся"}
                {" · "}
                {encounter.status === "revealed" ? "Контакт открыт"
                  : encounter.status === "cancelled" ? "Отменён" : "Анонимный диалог"}
              </p>
              <Link className="button secondary" href={"/relay/" + encounter.id}>Открыть диалог</Link>
            </article>
          )) : <p className="muted">{archive ? "Архив пуст." : "Активных диалогов пока нет."}</p>}
        </div>
      </section>
    </main>
  );
}
