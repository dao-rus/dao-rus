import Link from "next/link";
import { redirect } from "next/navigation";
import { listParticipantsDirectory } from "@/lib/participants-directory";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

type ParticipantsPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function ParticipantsPage({ searchParams }: ParticipantsPageProps) {
  const viewer = await getCurrentParticipant();
  if (!viewer) redirect("/");

  const { q = "" } = await searchParams;
  const participants = await listParticipantsDirectory(q);

  return (
    <main className="shell">
      <section className="card participantsPage">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">DAO Core</div>
            <h1>Участники</h1>
            <p className="muted">
              Профили людей, уже представленных в Core. Найдено: {participants.length}.
            </p>
          </div>
          <Link className="button secondary" href="/profile">К профилю</Link>
        </div>

        <form className="participantsSearch" method="get">
          <label htmlFor="participants-search">Имя или Telegram username</label>
          <div>
            <input
              id="participants-search"
              name="q"
              defaultValue={q}
              placeholder="Например, Анна или @username"
            />
            <button className="button primary" type="submit">Найти</button>
            {q ? <Link className="button secondary" href="/participants">Сбросить</Link> : null}
          </div>
        </form>

        {participants.length ? (
          <ul className="participantsDirectory">
            {participants.map((participant) => (
              <li key={participant.participantId}>
                <div>
                  <strong>{participant.displayName}</strong>
                  <span className="muted">
                    {participant.telegramUsername
                      ? `@${participant.telegramUsername}`
                      : "Telegram username не указан"}
                  </span>
                </div>
                <div className="participantDirectoryActions">
                  <span className={participant.isVerified ? "verificationBadge verified" : "verificationBadge"}>
                    {participant.isVerified
                      ? "✓ Личность подтверждена"
                      : "Пока не подтверждена"}
                  </span>
                  <Link className="button secondary" href={`/profile/${participant.participantId}`}>
                    Открыть профиль
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Профили по этому запросу не найдены.</p>
        )}
      </section>
    </main>
  );
}
