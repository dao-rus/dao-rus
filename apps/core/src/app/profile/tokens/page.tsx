import { getOwnDarusBook } from "@/lib/darus-holds";
import { readInterfaceTexts } from "@/lib/interface-texts";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { CoreNavigation } from "../../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { formatDarusAmount, getDarusBalance, getDarusHistory } from "@/lib/tokenization";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "DARUS" };
const onboardingReasons = {
  residence_first_filled: "Первое заполнение места жительства",
  interest_first_added: "Первый интерес",
  need_first_created: "Первое «Мне нужно»",
  have_first_created: "Первое «У меня есть»",
  onboarding_promise_reconciled: "Выполнение обещания onboarding: c926a20",
};

export default async function TokensPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const [balance, history, {values:texts}, book] = await Promise.all([
    getDarusBalance(participant.id), getDarusHistory(participant.id), readInterfaceTexts(), getOwnDarusBook(participant.id),
  ]);

  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation current="profile" />
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Профиль участия</div>
            <h1>DARUS</h1>
            <p className="muted">Внутренняя валюта ДАО. Баланс: <strong>{formatDarusAmount(balance)} DARUS</strong></p>
          </div>
          <Link className="button secondary" href="/profile">К профилю</Link>
        </div>
        <section className="activityHistory">
          <h2>История начислений</h2>
          {book.filter(entry=>entry.kind!=="mint"&&String(entry.source_type).startsWith("veche_")).map(entry=><p key={String(entry.id)}>{texts[entry.kind==="hold"?"veche.tariff_debit":"veche.attention_payment"]}: {formatDarusAmount(String(entry.amount))} DARUS {entry.source_id?<Link href={`/veche/${String(entry.source_id)}`}>{texts["veche.title"]}</Link>:null}</p>)}
          {history.length ? <ol>{history.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>+{formatDarusAmount(String(entry.amount))} DARUS · {entry.sourceType === "verification_created"
                  ? `Подтверждение личности: ${entry.subjectName}` : entry.sourceType === "veche_participation" ? texts["veche.participation_reward"] : entry.sourceType === "veche_organizer" ? texts["veche.organizer_reward"] : onboardingReasons[entry.sourceType]}</strong>
                <span className="muted"><LocalDateTime value={entry.createdAt.toISOString()} /></span>
                <small className="muted">Тариф: {formatDarusAmount(String(entry.tariff))} DARUS · версия {entry.rewardRuleVersion}</small>
              </div>
            </li>
          ))}</ol> : <p className="muted">Начислений пока нет.</p>}
        </section>
      </section>
    </main>
  );
}
