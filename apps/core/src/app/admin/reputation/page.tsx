import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getReputationHistory } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminReputationPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const history = await getReputationHistory();

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div><div className="eyebrow">DAO Core</div><h1>История репутационных сигналов</h1></div>
          <Link className="button secondary" href="/admin">К управлению</Link>
        </div>
        {history.length ? (
          <section className="activityHistory">
            <ol>
              {history.map((signal) => (
                <li key={signal.id}>
                  <div>
                    <strong><Link href={`/profile/${signal.actorId}`}>{signal.actorName}</Link> → <Link href={`/profile/${signal.subjectId}`}>{signal.subjectName}</Link></strong>
                    <span>{signal.signalType === "positive" ? "Хороший опыт взаимодействия" : "Есть проблема"} · {signal.revokedAt ? "отозван" : "активен"}</span>
                    <span className="muted">Создан: <LocalDateTime value={signal.createdAt.toISOString()} /></span>
                    {signal.revokedAt ? <span className="muted">Отозван: <LocalDateTime value={signal.revokedAt.toISOString()} /></span> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : <p className="muted">Сигналов пока нет.</p>}
      </section>
    </main>
  );
}
