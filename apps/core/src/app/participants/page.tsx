import { getAwardBadges } from "@/lib/award-views";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { CoreNavigation } from "../../components/core-navigation";
import { ParticipantName } from "../../components/participant-name";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listParticipantsDirectory, type DirectorySort } from "@/lib/participants-directory";
import { normalizeResidence, residenceLabel, type Residence } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";
import { communityFromParams, communityHref, listCommunityPosts, listCommunitySignals } from "@/lib/communities";
import { LocalDateTime } from "@/components/local-date-time";
import { UserText } from "../../components/user-text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Сеть" };

type ParticipantsPageProps = {
  searchParams: Promise<{ q?: string; interest?: string; residence_name?: string; residence_type?: string; residence_country?: string; post?: string; sort?: string }>;
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
  const sort: DirectorySort = params.sort === "verification" || params.sort === "reputation" || params.sort === "core" || params.sort === "joined"
    ? params.sort : "name";
  const filterParams = new URLSearchParams();
  if (interestFilter) filterParams.set("interest", interestFilter);
  if (residenceFilter) {
    filterParams.set("residence_name", residenceFilter.name);
    filterParams.set("residence_type", residenceFilter.type);
    filterParams.set("residence_country", residenceFilter.country);
  }
  const filterAndSortParams = new URLSearchParams(filterParams);
  if (sort !== "name") filterAndSortParams.set("sort", sort);
  const filterHref = filterAndSortParams.size ? `/participants?${filterAndSortParams.toString()}` : "/participants";
  const sortHref = (choice: DirectorySort) => {
    const query = new URLSearchParams(filterParams);
    if (q) query.set("q", q);
    if (choice !== "name") query.set("sort", choice);
    return query.size ? `/participants?${query.toString()}` : "/participants";
  };
  const directoryFilters = { interest: interestFilter, residence: residenceFilter, viewerParticipantId: viewer.id,
    ...(sort !== "name" ? { sort } : {}) };
  const [participants, { values: texts }, posts] = await Promise.all([
    listParticipantsDirectory(q, directoryFilters),
    readInterfaceTexts(),
    community ? listCommunityPosts(community) : Promise.resolve([]),
  ]);
  const awardBadges = await getAwardBadges(participants.map(p => p.participantId));
  const members = community && q
    ? await listParticipantsDirectory("", directoryFilters)
    : participants;
  const signals = community?.type === "residence"
    ? await listCommunitySignals(participants.map((participant) => participant.participantId), viewer.id)
    : [];
  const communityUrl = community ? communityHref(community) : null;
  const isMember = community ? members.some((participant) => participant.participantId === viewer.id) : false;
  const signalLabels = { want: "Я хочу", need: "Мне нужно", can: "Я могу", have: "У меня есть" };
  const signalIndicators = { need: { symbol: "?", label: "Нужно" },
    can: { symbol: "!", label: "Могу" }, want: { symbol: "♥", label: "Хочу" },
    have: { symbol: "+", label: "Есть" } } as const;

  return (
    <main className={`shell${community ? " communityShell" : ""}`}>
      <section className={`card participantsPage${community ? " communityPage" : ""}`}>
        <CoreNavigation current="participants" texts={texts} />
        <div className="profileHeader">
          <div>
            <div className="eyebrow">ДАО Русь</div>
            <h1>{community
              ? community.type === "residence"
                ? `${texts["community.residence_title"]} ${residenceLabel(community.residence)}`
                : `${texts["community.interest_title"]}: ${community.interest}`
              : texts["participants.title"]}</h1>
            <p className="muted">{community ? "Участников" : "Найдено"}: {community ? members.length : participants.length}.</p>
            {interestFilter ? (
              <p className="muted">Интерес: {interestFilter} · <Link href="/participants">Показать всех</Link></p>
            ) : null}
            {residenceFilter ? (
              <p className="muted">Место жительства: {residenceLabel(residenceFilter)} · <Link href="/participants">Показать всех</Link></p>
            ) : null}
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
          {sort !== "name" ? <input type="hidden" name="sort" value={sort} /> : null}
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

        <nav className="participantsSort" aria-label="Сортировка участников">
          <span>{texts["participants.sort_label"]}</span>
          {(["name", "verification", "reputation", "joined", "core"] as const).map((choice) => (
            <Link key={choice} href={sortHref(choice)} aria-current={sort === choice ? "page" : undefined}>
              {texts[`participants.sort_${choice}`]}
            </Link>
          ))}
        </nav>

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
                    <strong><ParticipantName awardBadges={awardBadges[participant.participantId]} participantId={participant.participantId}
                      verificationPoints={participant.verificationPoints} positiveCount={participant.positiveCount}>{participant.displayName}</ParticipantName></strong>
                    {!community ? <><span className="muted">
                      {participant.telegramUsername
                        ? `@${participant.telegramUsername}`
                        : "Имя в Telegram не указано"}
                    </span>
                    {participant.telegramBio ? <small className="muted">{participant.telegramBio}</small> : null}
                    {participant.residence ? <small className="muted">{residenceLabel(participant.residence)}</small> : null}</> : null}
                    <div className="participantSignalIndicators">
                      {(["need", "can", "want", "have"] as const).map((kind) => {
                        const count = participant.signalCounts?.[kind] ?? 0;
                        const { symbol, label } = signalIndicators[kind];
                        return count > 0 ? <Link key={kind} href={`/profile/${participant.participantId}#signal-${kind}`}
                          title={label} aria-label={`${label}: ${count}`}>
                          <span aria-hidden="true">{symbol}</span> {count}
                        </Link> : null;
                      })}
                    </div>
                  </div>
                </div>
                {community?.type === "residence" ? (
                  <div className="communitySignals">
                    {(["want", "need", "can", "have"] as const).map((kind) => {
                      const entries = signals.filter((signal) => signal.participantId === participant.participantId && signal.kind === kind);
                      return <div key={kind}><strong>{signalLabels[kind]}</strong>
                        {entries.length ? <ul>{entries.map((entry, index) => <li key={index}><UserText inline text={entry.body} /></li>)}</ul>
                          : <span className="muted">Пока не указано.</span>}</div>;
                    })}
                  </div>
                ) : null}
                {!community && participant.joinedAt ? <div className="participantDirectoryActions">
                  <small className="muted">{texts["profile.forum_since"]} <LocalDateTime dateOnly value={participant.joinedAt.toISOString()} /></small>
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
          <UserText text={post.body} />
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
