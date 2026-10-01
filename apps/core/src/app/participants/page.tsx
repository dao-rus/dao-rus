import Link from "next/link";
import { redirect } from "next/navigation";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { ParticipantName } from "../../components/participant-name";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listParticipantsDirectory } from "@/lib/participants-directory";
import { normalizeResidence, residenceLabel, type Residence } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

type ParticipantsPageProps = {
  searchParams: Promise<{ q?: string; interest?: string; residence_name?: string; residence_type?: string; residence_country?: string }>;
};

function residenceFromQuery(params: Awaited<ParticipantsPageProps["searchParams"]>): Residence | null {
  if (!params.residence_name && !params.residence_type && !params.residence_country) return null;
  try {
    return normalizeResidence({
      name: params.residence_name,
      type: params.residence_type,
      country: params.residence_country,
    });
  } catch {
    return null;
  }
}

export default async function ParticipantsPage({ searchParams }: ParticipantsPageProps) {
  const viewer = await getCurrentParticipant();
  if (!viewer) redirect("/");

  const params = await searchParams;
  const { q = "", interest = "" } = params;
  const interestFilter = typeof interest === "string" ? interest.trim() : "";
  const residenceFilter = residenceFromQuery(params);
  const filterParams = new URLSearchParams();
  if (interestFilter) filterParams.set("interest", interestFilter);
  if (residenceFilter) {
    filterParams.set("residence_name", residenceFilter.name);
    filterParams.set("residence_type", residenceFilter.type);
    filterParams.set("residence_country", residenceFilter.country);
  }
  const filterHref = filterParams.size ? `/participants?${filterParams.toString()}` : "/participants";
  const [participants, { values: texts }] = await Promise.all([
    listParticipantsDirectory(q, { interest: interestFilter, residence: residenceFilter, viewerParticipantId: viewer.id }),
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
            {residenceFilter ? (
              <p className="muted">Место жительства: {residenceLabel(residenceFilter)} · <Link href="/participants">Показать всех</Link></p>
            ) : null}
          </div>
          <div className="profileActions">
            <Link className="button secondary" href="/">Главная</Link>
            <Link className="button secondary" href="/veche">Вече</Link>
            <Link className="button secondary" href="/exchange">{texts["exchange.title"]}</Link>
            <Link className="button secondary" href="/profile">{texts["home.profile_button"]}</Link>
          </div>
        </div>

        <form className="participantsSearch" method="get">
          <label htmlFor="participants-search">Имя или имя в Telegram</label>
          {interestFilter ? <input type="hidden" name="interest" value={interestFilter} /> : null}
          {residenceFilter ? <>
            <input type="hidden" name="residence_name" value={residenceFilter.name} />
            <input type="hidden" name="residence_type" value={residenceFilter.type} />
            <input type="hidden" name="residence_country" value={residenceFilter.country} />
          </> : null}
          <div>
            <input
              id="participants-search"
              name="q"
              defaultValue={q}
              placeholder="Например, Анна или @username"
            />
            <button className="button primary" type="submit">Найти</button>
            {q ? <Link className="button secondary" href={filterHref}>Сбросить</Link> : null}
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
                    <strong><ParticipantName participantId={participant.participantId}
                      verificationPoints={participant.verificationPoints} positiveCount={participant.positiveCount}>{participant.displayName}</ParticipantName></strong>
                    <span className="muted">
                      {participant.telegramUsername
                        ? `@${participant.telegramUsername}`
                        : "Имя в Telegram не указано"}
                    </span>
                    {participant.telegramBio ? <small className="muted">{participant.telegramBio}</small> : null}
                    {participant.residence ? <small className="muted">{residenceLabel(participant.residence)}</small> : null}
                  </div>
                </div>
                <div className="participantDirectoryActions">
                  <Link className="button secondary" href={`/profile/${participant.participantId}`}>
                    Открыть профиль
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{residenceFilter
            ? (q ? "Люди из этого места по запросу не найдены." : "Люди из этого места пока не найдены.")
            : interestFilter ? (q ? "Участники с этим интересом по запросу не найдены." : "Участники с этим интересом не найдены.")
              : "Профили по этому запросу не найдены."}</p>
        )}
      </section>
    </main>
  );
}
