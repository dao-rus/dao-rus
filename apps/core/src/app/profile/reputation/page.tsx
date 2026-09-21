import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReputationPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  return (
    <main className="shell">
      <section className="card profile">
        <div className="eyebrow">Ядро</div>
        <h1>Карма</h1>
        <p className="muted">
          Здесь будет собираться репутационная история участника: отзывы и опыт взаимодействия
          с другими людьми в ДАО Русь.
        </p>
        <Link className="button secondary" href="/profile">Вернуться в профиль</Link>
      </section>
    </main>
  );
}
