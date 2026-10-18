import type { Metadata } from "next";
import Link from "next/link";
import { countSlovotvorWordsByAuthor, getSlovotvorAuthorById, getSlovotvorWordById, getSlovotvorWordBySlug, listSlovotvorWords, type SlovotvorSort } from "@/lib/slovotvor";
import { getCurrentParticipant } from "@/lib/session";
import { SlovotvorPublicationForm } from "./publication-form";

export const metadata: Metadata = { title: "Словотвор" };
export const dynamic = "force-dynamic";

const sortOptions: Array<{ value: SlovotvorSort; label: string }> = [
  { value: "top", label: "Топ" },
  { value: "alpha", label: "А–Я" },
  { value: "new", label: "Новые" },
  { value: "old", label: "Старые" },
];

function normalizedTelegramUsername(username: string | null): string | null {
  const value = username?.trim().replace(/^@+/, "") || null;
  return value && /^[A-Za-z0-9_]{5,32}$/.test(value) ? value : null;
}

function VoteThumb({ direction }: { direction: "up" | "down" }) {
  return <svg className="slovotvorVoteIcon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === "up" ? <><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" /></> : <><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" /></>}
  </svg>;
}

export default async function SlovotvorPage({ searchParams }: {
  searchParams: Promise<{ error?: string; slug?: string; source?: string; parent?: string; author?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const sort: SlovotvorSort = params.sort === "alpha" || params.sort === "new" || params.sort === "old" ? params.sort : "top";
  const [participant, author, words] = await Promise.all([
    getCurrentParticipant(),
    params.author ? getSlovotvorAuthorById(params.author) : Promise.resolve(null),
    listSlovotvorWords(params.author, sort),
  ]);
  const ownWordCount = participant ? await countSlovotvorWordsByAuthor(participant.id) : 0;
  const parentTask = params.parent ? await getSlovotvorWordById(params.parent) : null;
  const duplicate = params.error === "duplicate" && params.slug ? await getSlovotvorWordBySlug(params.slug) : null;
  const errorMessage = params.error === "required" ? "Заполните хотя бы одно поле"
    : params.error === "too_long" ? "Одно из полей превышает допустимую длину"
      : params.error === "parent_invalid" ? "Не удалось связать вариант с заданием"
        : params.error === "failed" ? "Не удалось выпустить слово" : null;
  const authorUsername = author ? normalizedTelegramUsername(author.telegramUsername) : null;
  const participantUsername = participant ? normalizedTelegramUsername(participant.telegramUsername) : null;

  return (
    <main className="shell">
      <section className="card slovotvorPage">
        <div className="slovotvorIntro">
          <h1>Словотвор</h1>
          {!params.author ? <p className="lead">Придумай лучше. Предложи заменить. Опиши неназванное.</p> : null}
        </div>
        {!params.author ? <>
          {errorMessage ? <p className="formError" role="alert">{errorMessage}</p> : null}
          {duplicate ? <p className="formError" role="alert">Слово уже добавлено. <Link href={`/slovotvor/${duplicate.slug}`}>Открыть карточку</Link></p> : null}
          <SlovotvorPublicationForm
            defaultSource={parentTask?.sourceWord ?? params.source ?? ""}
            defaultParentId={parentTask?.word ? "" : parentTask?.id ?? ""}
          />
        </> : null}

        <div className="slovotvorCatalogHeader">
          <h2>{author ? <>Список новых слов от {authorUsername ?? author.displayName}</> : "Список новых слов"}</h2>
          <nav className="slovotvorSort" aria-label="Порядок слов">
            {sortOptions.map((option) => {
              const query = new URLSearchParams();
              query.set("sort", option.value);
              if (params.author) query.set("author", params.author);
              return <Link key={option.value} href={`/slovotvor?${query.toString()}`} aria-current={sort === option.value ? "true" : undefined}>{option.label}</Link>;
            })}
          </nav>
        </div>

        <div className="slovotvorCards">
          {words.map((entry) => (
            <article className="slovotvorCard" key={entry.id}>
              <Link className="slovotvorCardLink" href={`/slovotvor/${entry.slug}`}>
                <div className="slovotvorWordLine">
                  {entry.word ? <strong>{entry.word}</strong> : null}
                  {entry.sourceWord ? <span aria-hidden="true">←</span> : null}
                  {entry.sourceWord ? <span>{entry.sourceWord}</span> : null}
                  {!entry.word && !entry.sourceWord && entry.explanation ? <p className="slovotvorDescriptionPreview">{entry.explanation}</p> : null}
                </div>
                {entry.word ? <div className="slovotvorCardVotes" aria-label="Оценки">
                  <span className="slovotvorBetter" title="Удачное слово" aria-label={`Удачное слово: ${entry.betterVotes}`}><VoteThumb direction="up" />{entry.betterVotes}</span>
                  <span className="slovotvorWorse" title="Неудачное слово" aria-label={`Неудачное слово: ${entry.worseVotes}`}><VoteThumb direction="down" />{entry.worseVotes}</span>
                </div> : null}
                <div className="slovotvorCardFooter">
                  <span className="slovotvorAuthor">{entry.authorName}</span>
                </div>
              </Link>
            </article>
          ))}
        </div>

        {params.author ? <Link className="slovotvorAllWordsLink" href="/slovotvor">Все слова</Link> : null}

        {participant ? <div className="slovotvorUserBar">
          <span>Вы вошли как: {participantUsername ? <a href={`https://t.me/${encodeURIComponent(participantUsername)}`}>{participantUsername}</a> : participant.displayName}</span>
          <span aria-hidden="true">·</span>
          <span>Ваши слова: <Link href={`/slovotvor?author=${encodeURIComponent(participant.id)}`}>{ownWordCount}</Link></span>
          <span aria-hidden="true">·</span>
          <form className="slovotvorLogoutForm" action="/api/auth/logout" method="post">
            <button className="slovotvorLogoutButton" type="submit">Выйти</button>
          </form>
        </div> : null}
      </section>
    </main>
  );
}
