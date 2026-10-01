import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { getCurrentParticipant } from "@/lib/session";
import { getDarusBalance, getDarusHistory } from "@/lib/tokenization";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "DARUS" };

export default async function TokensPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const [balance, history] = await Promise.all([
    getDarusBalance(participant.id), getDarusHistory(participant.id),
  ]);

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Профиль участия</div>
            <h1>DARUS</h1>
            <p className="muted">Внутренняя валюта ДАО. Баланс: <strong>{balance} DARUS</strong></p>
          </div>
          <Link className="button secondary" href="/profile">К профилю</Link>
        </div>
        <section className="activityHistory">
          <h2>История начислений</h2>
          {history.length ? <ol>{history.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>+{entry.amount} DARUS · Подтверждение личности: {entry.subjectName}</strong>
                <span className="muted"><LocalDateTime value={entry.createdAt.toISOString()} /></span>
                <small className="muted">Тариф: {entry.tariff} DARUS · версия {entry.rewardRuleVersion}</small>
              </div>
            </li>
          ))}</ol> : <p className="muted">Начислений пока нет.</p>}
        </section>
      </section>
    </main>
  );
}
