import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { listVerificationRoots } from "@/lib/verification";
import { AdminCrumbs } from "../../../components/admin-crumbs";
import { CoreNavigation } from "../../../components/core-navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Начальное ядро доверия" };

export default async function VerificationRootsPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const roots = await listVerificationRoots();
  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation />
        <div className="profileHeader">
          <div>
            <AdminCrumbs href="/admin/verification-roots" />
            <h1>Начальное ядро доверия</h1>
            <p className="muted">
              Первые участники, которые лично знают друг друга: от них расходится подтверждение личности.
              Добавить человека можно на его странице кнопкой «Добавить в начальное ядро».
              Сейчас в ядре: {roots.length}.
            </p>
          </div>
        </div>
        {roots.length ? (
          <ol>
            {roots.map((root) => (
              <li key={root.subjectId}>
                <Link href={`/profile/${root.subjectId}`}>{root.displayName}</Link>
                <span className="muted">
                  {" · добавлен "}{root.addedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long" })}
                  {root.addedByName ? <>{" · "}{root.addedByName}</> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="muted">Начальное ядро пока пусто.</p>}
      </section>
    </main>
  );
}
