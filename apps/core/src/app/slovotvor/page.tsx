import type { Metadata } from "next";
import Link from "next/link";
import { countSlovotvorWordsByAuthor, getSlovotvorAuthorById, getSlovotvorWordBySlug, listSlovotvorWords, type SlovotvorSort } from "@/lib/slovotvor";
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

export default async function SlovotvorPage({ searchParams }: {
  searchParams: Promise<{ error?: string; slug?: string; source?: string; author?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const sort: SlovotvorSort = params.sort === "alpha" || params.sort === "new" || params.sort === "old" ? params.sort : "top";
  const [participant, author, words] = await Promise.all([
    getCurrentParticipant(),
    params.author ? getSlovotvorAuthorById(params.author) : Promise.resolve(null),
    listSlovotvorWords(params.author, sort),
  ]);
  const ownWordCount = participant ? await countSlovotvorWordsByAuthor(participant.id) : 0;
  const duplicate = params.error === "duplicate" && params.slug ? await getSlovotvorWordBySlug(params.slug) : null;
  const errorMessage = params.error === "required" ? "Заполните хотя бы одно поле"
    : params.error === "too_long" ? "Одно из полей превышает допустимую длину"
      : params.error === "failed" ? "Не удалось выпустить слово" : null;
  const authorUsername = author ? normalizedTelegramUsername(author.telegramUsername) : null;
  const participantUsername = participant ? normalizedTelegramUsername(participant.telegramUsername) : null;

  return (
    <main className="shell">
      <section className="card slovotvorPage">
        <h1>Словотвор</h1>
        {!params.author ? <>
          <p className="lead">Придумай лучше. Предложи заменить. Опиши неназванное.</p>
          {errorMessage ? <p className="formError" role="alert">{errorMessage}</p> : null}
          {duplicate ? <p className="formError" role="alert">Слово уже добавлено. <Link href={`/slovotvor/${duplicate.slug}`}>Открыть карточку</Link></p> : null}
          <SlovotvorPublicationForm defaultSource={params.source ?? ""} />
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
