import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { ParticipantName } from "../../components/participant-name";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listParticipantsDirectory } from "@/lib/participants-directory";
import { normalizeResidence, residenceLabel, type Residence } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";
import { communityFromParams, communityHref, listCommunityPosts, listCommunitySignals } from "@/lib/communities";
import { LocalDateTime } from "@/components/local-date-time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Сеть" };

type ParticipantsPageProps = {
  searchParams: Promise<{ q?: string; interest?: string; residence_name?: string; residence_type?: string; residence_country?: string; post?: string }>;
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
  const community = communityFromParams(params);
  const filterParams = new URLSearchParams();
  if (interestFilter) filterParams.set("interest", interestFilter);
  if (residenceFilter) {
    filterParams.set("residence_name", residenceFilter.name);
    filterParams.set("residence_type", residenceFilter.type);
    filterParams.set("residence_country", residenceFilter.country);
  }
  const filterHref = filterParams.size ? `/participants?${filterParams.toString()}` : "/participants";
  const [participants, { values: texts }, posts] = await Promise.all([
    listParticipantsDirectory(q, { interest: interestFilter, residence: residenceFilter, viewerParticipantId: viewer.id }),
    readInterfaceTexts(),
    community ? listCommunityPosts(community) : Promise.resolve([]),
  ]);
  const members = community && q
    ? await listParticipantsDirectory("", { interest: interestFilter, residence: residenceFilter, viewerParticipantId: viewer.id })
    : participants;
  const signals = community?.type === "residence"
    ? await listCommunitySignals(participants.map((participant) => participant.participantId), viewer.id)
    : [];
  const communityUrl = community ? communityHref(community) : null;
  const isMember = community ? members.some((participant) => participant.participantId === viewer.id) : false;
  const signalLabels = { want: "Я хочу", need: "Мне нужно", can: "Я могу", have: "У меня есть" };

  return (
    <main className={`shell${community ? " communityShell" : ""}`}>
      <section className={`card participantsPage${community ? " communityPage" : ""}`}>
        <div className="profileHeader">
          <div>
            <div className="eyebrow">ДАО Русь</div>
            <h1>{community
              ? `${community.type === "residence" ? texts["community.residence_title"] : texts["community.interest_title"]}: ${community.type === "residence" ? residenceLabel(community.residence) : community.interest}`
              : texts["participants.title"]}</h1>
            <p className="muted">{community ? "Участников" : "Найдено"}: {community ? members.length : participants.length}.</p>
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

        <div className={community ? "communityColumns" : undefined}>
          <section className={community ? "communityMembers" : undefined}>
            {community ? <h2>{texts["community.members_title"]}</h2> : null}

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
                    {!community ? <><span className="muted">
                      {participant.telegramUsername
                        ? `@${participant.telegramUsername}`
                        : "Имя в Telegram не указано"}
                    </span>
                    {participant.telegramBio ? <small className="muted">{participant.telegramBio}</small> : null}
                    {participant.residence ? <small className="muted">{residenceLabel(participant.residence)}</small> : null}</> : null}
                  </div>
                </div>
                {community?.type === "residence" ? (
                  <div className="communitySignals">
                    {(["want", "need", "can", "have"] as const).map((kind) => {
                      const entries = signals.filter((signal) => signal.participantId === participant.participantId && signal.kind === kind);
                      return <div key={kind}><strong>{signalLabels[kind]}</strong>
                        {entries.length ? <ul>{entries.map((entry, index) => <li key={index}>{entry.body}</li>)}</ul>
                          : <span className="muted">Пока не указано.</span>}</div>;
                    })}
                  </div>
                ) : null}
                {!community ? <div className="participantDirectoryActions">
                  <Link className="button secondary" href={`/profile/${participant.participantId}`}>
                    Открыть профиль
                  </Link>
                </div> : null}
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
      {community && communityUrl ? <section className="communityFeed">
        <h2>{texts["community.feed_title"]}</h2>
        {params.post === "saved" ? <p role="status">Объявление сохранено.</p> : null}
        {params.post === "invalid" ? <p role="alert">Не удалось сохранить объявление. Проверьте текст и участие в сообществе.</p> : null}
        {isMember ? <form action="/api/community/posts" method="post">
          <input type="hidden" name="community" value={communityUrl} />
          <textarea name="body" maxLength={2000} required aria-label="Текст объявления" placeholder="Ваше объявление" />
          <button className="button primary" type="submit">Опубликовать</button>
        </form> : <p className="muted">Публиковать объявления могут участники сообщества.</p>}
        {posts.length ? <ol className="communityPosts">{posts.map((post) => <li key={post.id}>
          <p>{post.body}</p>
          <div className="muted"><Link href={`/profile/${post.authorId}`}>{post.authorName}</Link> · <LocalDateTime value={post.createdAt.toISOString()} /></div>
          {post.authorId === viewer.id ? <form action="/api/community/posts" method="post">
            <input type="hidden" name="community" value={communityUrl} />
            <input type="hidden" name="action" value="delete" />
            <input type="hidden" name="post_id" value={post.id} />
            <button className="button secondary compact" type="submit">Удалить</button>
          </form> : null}
        </li>)}</ol> : <p className="muted">{texts["community.feed_empty"]}</p>}
      </section> : null}
        </div>
      </section>
    </main>
  );
}
