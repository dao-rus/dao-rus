import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { getReputationSummary } from "@/lib/reputation";

export const dynamic = "force-dynamic";

export default async function ReputationPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const reputation = await getReputationSummary(participant.id, participant.id);

  return (
    <main className="shell">
      <section className="card profile">
        <div className="eyebrow">Ядро</div>
        <h1>Карма</h1>
        <p>Хороший опыт взаимодействия: <strong>{reputation.positiveCount}</strong></p>
        <p className="muted">Карма пока не является единым рейтингом. Здесь учитываются только положительные сигналы взаимодействия.</p>
        <Link className="button secondary" href="/profile">Вернуться в профиль</Link>
      </section>
    </main>
  );
}
