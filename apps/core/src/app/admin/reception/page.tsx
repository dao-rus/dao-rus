import { redirect } from "next/navigation";
import { AdminCrumbs } from "@/components/admin-crumbs";
import { CoreNavigation } from "@/components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { listReceptionApplications, receptionDeliveryErrors, receptionMessageLink } from "@/lib/reception-admin";
import { readInterfaceTexts } from "@/lib/interface-texts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Заявки" };
const date = (value: Date | null) => value ? value.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "—";
const statuses: Record<string, string> = { pending: "Ожидает отправки", processing: "Обрабатывается", delivered: "Доставка подтверждена", needs_review: "Требуется сверка", failed: "Ошибка", submitted: "Подана", deferred: "Отложена", closed: "Закрыта" };

export default async function ReceptionJournal({ searchParams }: { searchParams?: Promise<{ review?: string; page?: string }> } = {}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const params = await searchParams;
  const requestedPage = Number(params?.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1000000 ? requestedPage : 1;
  const [rows, { values: texts }] = await Promise.all([listReceptionApplications(participant.id, undefined, page), readInterfaceTexts()]);
  return <main className="shell"><section className="card profile">
    <CoreNavigation texts={texts} /><AdminCrumbs href="/admin/reception" texts={texts} />
    <h1>{texts["reception.admin.title"]}</h1><p>{texts["reception.admin.privacy"]}</p>
    {rows.length === 0 ? <p>{texts["reception.admin.empty"]}</p> : null}
    {rows.map(a => {
      const link = receptionMessageLink(a.telegram_chat_id, a.telegram_message_id);
      const fields = <><input type="hidden" name="id" value={a.id} /><input type="hidden" name="version" value={a.version} /></>;
      return <article className="card" key={a.id}>
        <h2>{a.telegram_name || "Telegram-имя ещё не получено"} {a.telegram_username ? `@${a.telegram_username}` : ""}</h2>
        <p>{texts["reception.apply.city"]}: {a.city}<br />{texts["reception.apply.occupation"]}: {a.occupation}{a.age !== null ? <><br />{texts["reception.apply.preview_age"]}: {a.age}</> : null}</p>
        <p>Подана: {date(a.created_at)} · Изменена: {date(a.updated_at)}<br />
          Заявка: {statuses[a.application_status]} · Доставка: {statuses[a.status]}<br />
          Ревизия: {a.revision} · Опубликована: {a.delivered_revision ?? "—"}</p>
        {link ? <p><a href={link} target="_blank" rel="noreferrer">{texts["reception.admin.message"]}</a></p> : null}
        {a.error_code ? <p role="status">{receptionDeliveryErrors[a.error_code] ?? "Telegram отклонил запрос. Проверьте настройки доставки."}</p> : null}
        <form action="/api/admin/reception" method="post">{fields}<button name="action" value="inspect">{texts["reception.admin.inspect"]}</button></form>
        {params?.review === a.id ? <section>
          <p>{texts["reception.admin.review"]}</p>
          {a.review_text ? <><p>{texts["reception.admin.snapshot"]}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.review_text}</pre></> : null}
          <dl><dt>Telegram ID</dt><dd>{a.telegram_user_id}</dd><dt>Chat / тема / сообщение</dt><dd>{a.telegram_chat_id ?? "—"} / {a.telegram_topic_id ?? "—"} / {a.telegram_message_id ?? "—"}</dd>
            <dt>Попытка / ревизия / число попыток</dt><dd>{date(a.attempted_at)} / {a.attempted_revision ?? "—"} / {a.attempts}</dd><dt>Следующий повтор</dt><dd>{date(a.retry_at)}</dd></dl>
          {a.status === "needs_review" ? <>
            <form action="/api/admin/reception" method="post">{fields}
              <label>ID проверенного сообщения <input name="messageId" inputMode="numeric" pattern="[0-9]+" required defaultValue={a.telegram_message_id ?? ""} /></label>
              <label><input type="checkbox" name="verified" required />{texts["reception.admin.present"]}</label>
              <button name="action" value="confirm">{texts["reception.admin.confirm"]}</button></form>
            <form action="/api/admin/reception" method="post">{fields}<label><input type="checkbox" name="verified" required />{texts["reception.admin.absent"]}</label>
              <button name="action" value="retry">{texts["reception.admin.retry"]}</button></form>
          </> : null}
        </section> : null}
      </article>;
    })}
    <nav aria-label="Страницы заявок">
      {page > 1 ? <a href={`/admin/reception?page=${page-1}`}>{texts["reception.admin.previous"]}</a> : null}{" "}
      {rows.length === 50 ? <a href={`/admin/reception?page=${page+1}`}>{texts["reception.admin.next"]}</a> : null}
    </nav>
  </section></main>;
}
