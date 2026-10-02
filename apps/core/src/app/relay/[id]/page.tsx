import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { getRelayEncounter, listRelayMessages, RelayValidationError } from "@/lib/relay";
import { CoreNavigation } from "../../../components/core-navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Диалог" };

export default async function RelayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  let encounter;
  try {
    encounter = await getRelayEncounter(participant.id, (await params).id);
  } catch (error) {
    if (error instanceof RelayValidationError) notFound();
    throw error;
  }
  if (!encounter) notFound();
  const [messages, { values: texts }] = await Promise.all([
    listRelayMessages(participant.id, encounter.id),
    readInterfaceTexts(),
  ]);
  const otherRole = encounter.role === "author" ? "Откликнувшийся" : "Автор сигнала";
  const writable = encounter.status !== "cancelled";

  return (
    <main className="shell">
      <section className="card exchangePage">
        <CoreNavigation current="exchange" texts={texts} />
        <div className="eyebrow">DAO Rus · Анонимный диалог</div>
        <h1>{texts["relay.dialog_title"]}</h1>
        <p className="relaySignal">{encounter.body}</p>
        <p className="muted">Вы: {encounter.role === "author" ? "Автор сигнала" : "Откликнувшийся"}</p>
        {encounter.other ? (
          <div className="relayReveal">
            <strong>Контакт открыт</strong>
            <p><Link href={"/profile/" + encounter.other.id}>{encounter.other.name}</Link></p>
            {encounter.other.username ? <p>Telegram: @{encounter.other.username}</p> : null}
          </div>
        ) : encounter.status === "cancelled" ? (
          <p className="muted">Диалог отменён и находится в архиве. Контакты не раскрываются.</p>
        ) : encounter.myConsent ? (
          <p className="formNotice">Вы согласились открыть контакт. Ожидаем вторую сторону.</p>
        ) : (
          <p className="muted">Личности сторон скрыты до взаимного согласия открыть контакт.</p>
        )}
        <div className="relayMessages">
          {messages.length ? messages.map((message) => (
            <article className={message.mine ? "relayMessage mine" : "relayMessage"} key={message.id}>
              <strong>{message.mine ? "Вы" : encounter.other?.name ?? otherRole}</strong>
              <p>{message.body}</p>
            </article>
          )) : <p className="muted">{texts["relay.messages_empty"]}</p>}
        </div>
        {writable ? (
          <>
            <form className="aboutForm relayForm" action="/api/relay" method="post">
              <input type="hidden" name="action" value="message" />
              <input type="hidden" name="encounter_id" value={encounter.id} />
              <label htmlFor="relay-message">Сообщение</label>
              <textarea id="relay-message" name="body" maxLength={2000} required />
              <button className="button primary" type="submit">Отправить</button>
            </form>
            <div className="actions">
              {encounter.status === "active" && !encounter.myConsent ? (
                <form action="/api/relay" method="post">
                  <input type="hidden" name="action" value="consent" />
                  <input type="hidden" name="encounter_id" value={encounter.id} />
                  <button className="button secondary" type="submit">Открыть контакт</button>
                </form>
              ) : null}
              <form action="/api/relay" method="post">
                <input type="hidden" name="action" value="cancel" />
                <input type="hidden" name="encounter_id" value={encounter.id} />
                <button className="button secondary" type="submit">Отмена</button>
              </form>
              <Link className="button secondary" href={"/relay/" + encounter.id}>Обновить</Link>
            </div>
          </>
        ) : null}
        <div className="actions">
          <Link className="button secondary" href={writable ? "/relay" : "/relay?archive=1"}>
            {writable ? texts["relay.list_title"] : "Архив"}
          </Link>
          <Link className="button secondary" href="/exchange">{texts["exchange.title"]}</Link>
        </div>
      </section>
    </main>
  );
}
