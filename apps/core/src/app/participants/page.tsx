import Link from "next/link";
import { redirect } from "next/navigation";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listParticipantsDirectory } from "@/lib/participants-directory";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

type ParticipantsPageProps = {
  searchParams: Promise<{ q?: string; interest?: string }>;
};

export default async function ParticipantsPage({ searchParams }: ParticipantsPageProps) {
  const viewer = await getCurrentParticipant();
  if (!viewer) redirect("/");

  const { q = "", interest = "" } = await searchParams;
  const interestFilter = typeof interest === "string" ? interest.trim() : "";
  const interestHref = `/participants?interest=${encodeURIComponent(interestFilter)}`;
  const [participants, { values: texts }] = await Promise.all([
    listParticipantsDirectory(q, { interest: interestFilter, viewerParticipantId: viewer.id }),
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
            {interestFilter ? (
              <p className="muted">Интерес: {interestFilter} · <Link href="/participants">Показать всех</Link></p>
            ) : null}
          </div>
          <Link className="button secondary" href="/profile">Ваш профиль</Link>
        </div>

        <form className="participantsSearch" method="get">
          <label htmlFor="participants-search">Имя или имя в Telegram</label>
          {interestFilter ? <input type="hidden" name="interest" value={interestFilter} /> : null}
          <div>
            <input
              id="participants-search"
              name="q"
              defaultValue={q}
              placeholder="Например, Анна или @username"
            />
            <button className="button primary" type="submit">Найти</button>
            {q ? <Link className="button secondary" href={interestFilter ? interestHref : "/participants"}>Сбросить</Link> : null}
          </div>
        </form>

        {participants.length ? (
          <ul className="participantsDirectory">
            {participants.map((participant) => (
              <li key={participant.participantId}>
                <div className="directoryIdentity">
                  <TelegramAvatar participantId={participant.participantId} displayName={participant.displayName}
                    avatarUrl={participant.avatarUrl} hasTelegramPhoto={participant.hasTelegramPhoto} />
                  <div>
                    <strong>{participant.displayName}</strong>
                    <span className="muted">
                      {participant.telegramUsername
                        ? `@${participant.telegramUsername}`
                        : "Имя в Telegram не указано"}
                    </span>
                    {participant.telegramBio ? <small className="muted">{participant.telegramBio}</small> : null}
                  </div>
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
          <p className="muted">{interestFilter ? (q ? "Участники с этим интересом по запросу не найдены." : "Участники с этим интересом не найдены.") : "Профили по этому запросу не найдены."}</p>
        )}
      </section>
    </main>
  );
}
