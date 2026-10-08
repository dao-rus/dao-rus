import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { visibleAdminGroups } from "../../lib/admin-access";
import { CoreNavigation } from "../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Управление" };

export default async function AdminPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const groups = visibleAdminGroups(participant.id);
  if (groups.length === 0) redirect("/profile");
  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation />
        <div className="profileHeader">
          <div><div className="eyebrow">DAO Core</div><h1>Управление</h1></div>
          <Link className="button secondary" href="/profile">К профилю</Link>
        </div>
        {groups.map((group) => (
          <section className="adminGroup" key={group.key} aria-labelledby={`admin-group-${group.key}`}>
            <h2 id={`admin-group-${group.key}`}>{group.title}</h2>
            <ul>
              {group.sections.map((section) => (
                <li key={section.href}>
                  <Link href={section.href}><strong>{section.title}</strong><span>{section.hint}</span></Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </main>
  );
}
