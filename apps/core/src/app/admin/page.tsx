import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { CoreNavigation } from "../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Управление" };

export default async function AdminPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation />
        <div className="profileHeader">
          <div><div className="eyebrow">DAO Core</div><h1>Управление</h1></div>
          <Link className="button secondary" href="/profile">К профилю</Link>
        </div>
        <nav className="actions" aria-label="Разделы управления">
          <Link className="button secondary" href="/admin/participants">Реестр ДАО</Link>
          <Link className="button secondary" href="/admin/interface">Тексты интерфейса</Link>
          <Link className="button secondary" href="/admin/rewards">Тарифы DARUS</Link>
          <Link className="button secondary" href="/admin/reputation">История репутации</Link>
          <Link className="button secondary" href="/admin/guardian">Хранитель</Link>
        </nav>
      </section>
    </main>
  );
}
