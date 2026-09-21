import Link from "next/link";
import { redirect } from "next/navigation";
import { readInterfaceTexts } from "@/lib/interface-texts";
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
  const [participants, { values: texts }] = await Promise.all([
    listParticipantsDirectory(q),
    readInterfaceTexts(),
  ]);

  return (
    <main className="shell">
      <section className="card participantsPage">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">ДАО Русь</div>
            <h1>{texts["participants.title"]}</h1>
            <p className="muted">Найдено: {participants.length}.</p>
          </div>
          <Link className="button secondary" href="/profile">Ваш профиль</Link>
        </div>

        <form className="participantsSearch" method="get">
          <label htmlFor="participants-search">Имя или имя в Telegram</label>
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
                      : "Имя в Telegram не указано"}
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
