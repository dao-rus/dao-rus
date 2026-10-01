import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getCurrentRewardRule } from "@/lib/tokenization";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Тарифы DARUS" };

type RewardsPageProps = { searchParams: Promise<{ reward_update?: string }> };

export default async function RewardsPage({ searchParams }: RewardsPageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [rule, params] = await Promise.all([getCurrentRewardRule(), searchParams]);
  const message = {
    updated: "Создана новая версия тарифа.",
    unchanged: "Тариф не изменился.",
    invalid: "Укажите положительную сумму с точностью до 6 знаков после точки.",
  }[params.reward_update ?? ""];

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">DAO Core</div>
            <h1>Тарифы DARUS</h1>
            <p className="muted">Действующая версия для новых подтверждений. Ранее начисленный DARUS не пересчитывается.</p>
          </div>
          <Link className="button secondary" href="/admin">К управлению</Link>
        </div>
        {message ? <p className={params.reward_update === "invalid" ? "formError" : "formNotice"}>{message}</p> : null}
        <form className="interfaceForm" action="/api/admin/rewards" method="post">
          <p><strong>Подтверждение личности другого участника</strong><br />
            <small className="muted">verification_created · версия {rule.version}</small></p>
          <div className="interfaceField">
            <label htmlFor="reward-amount">Начисление, DARUS</label>
            <input id="reward-amount" name="amount" type="number" min="0.000001" step="0.000001" defaultValue={rule.amount} required />
          </div>
          <label className="interfaceReset">
            <input type="checkbox" name="active" defaultChecked={rule.active} />
            Начисление включено
          </label>
          <button className="button primary" type="submit">Сохранить новую версию</button>
        </form>
      </section>
    </main>
  );
}
