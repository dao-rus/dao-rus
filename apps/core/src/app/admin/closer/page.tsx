import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { AdminCrumbs } from "../../../components/admin-crumbs";
import { CoreNavigation } from "../../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { listCloserGoals } from "@/lib/closer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Цели «Ближе»" };

export default async function CloserGoalsPage({ searchParams }: { searchParams: Promise<{ closer_update?: string }> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [goals, params] = await Promise.all([listCloserGoals(), searchParams]);
  const message = {
    updated: "Список целей сохранён.", unchanged: "Изменений нет.",
    invalid: "Проверьте названия (до 60 символов) и ключ новой цели: латиница, цифры и «_», уникальный.",
  }[params.closer_update ?? ""];
  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation />
        <div className="profileHeader">
          <div>
            <AdminCrumbs href="/admin/closer" />
            <h1>Цели «Ближе»</h1>
            <p className="muted">По цели ищутся совпадения. Цель нельзя удалить: отключённая перестаёт предлагаться
              и участвовать в подборе, а записи с ней сохраняются. «Спрашивать пол» добавляет в форму поля «Я» и «Ищу».</p>
          </div>
        </div>
        {message ? <p className={params.closer_update === "invalid" ? "formError" : "formNotice"}>{message}</p> : null}
        <form className="interfaceForm" action="/api/admin/closer" method="post">
          {goals.map((goal) => <div className="interfaceField" key={goal.key}>
            <label htmlFor={`goal-${goal.key}`}>{goal.key}</label>
            <input id={`goal-${goal.key}`} name={`name.${goal.key}`} defaultValue={goal.displayName} maxLength={60} required />
            <label className="interfaceReset"><input type="checkbox" name={`enabled.${goal.key}`} defaultChecked={goal.enabled} /> Включена</label>
            <label className="interfaceReset"><input type="checkbox" name={`gender.${goal.key}`} defaultChecked={goal.asksGender} /> Спрашивать пол</label>
          </div>)}
          <div className="interfaceField">
            <label htmlFor="goal-new-name">Новая цель</label>
            <input id="goal-new-name" name="new_name" maxLength={60} placeholder="Название" />
            <input name="new_key" maxLength={64} pattern="[a-z][a-z0-9_]*" placeholder="ключ латиницей, например travel" aria-label="Ключ новой цели" />
            <label className="interfaceReset"><input type="checkbox" name="new_gender" /> Спрашивать пол</label>
          </div>
          <button className="button primary" type="submit">Сохранить</button>
        </form>
      </section>
    </main>
  );
}
