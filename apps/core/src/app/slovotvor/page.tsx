import type { Metadata } from "next";
import Link from "next/link";
import { listSlovotvorWords, getSlovotvorWordBySlug } from "@/lib/slovotvor";

export const metadata: Metadata = { title: "Словотвор" };
export const dynamic = "force-dynamic";

export default async function SlovotvorPage({ searchParams }: {
  searchParams: Promise<{ error?: string; slug?: string }>;
}) {
  const words = await listSlovotvorWords();
  const params = await searchParams;
  const duplicate = params.error === "duplicate" && params.slug ? await getSlovotvorWordBySlug(params.slug) : null;
  const errorMessage = params.error === "required" ? "Заполните обязательные поля"
    : params.error === "too_long" ? "Одно из полей превышает допустимую длину"
      : params.error === "failed" ? "Не удалось выпустить слово" : null;
  return (
    <main className="shell">
      <section className="card slovotvorPage">
        <h1>Словотвор</h1>
        <p className="lead">Придумай лучше</p>

        {errorMessage ? <p className="formError" role="alert">{errorMessage}</p> : null}
        {duplicate ? <p className="formError" role="alert">Слово уже добавлено. <Link href={`/slovotvor/${duplicate.slug}`}>Открыть карточку</Link></p> : null}
        <form className="slovotvorForm" action="/api/slovotvor" method="post">
          <div className="slovotvorWordFields">
            <input name="word" type="text" placeholder="Новое слово" aria-label="Новое слово" required />
            <input name="source" type="text" placeholder="Вместо какого?" aria-label="Вместо какого?" required />
          </div>
          <label>
            Пояснение <span className="muted">(необязательно)</span>
            <textarea name="explanation" placeholder="Пояснение" rows={3} />
          </label>
          <button className="button primary" type="submit">Выпустить слово</button>
        </form>

        <div className="slovotvorCatalogHeader">
          <h2>Список новых слов</h2>
          <nav className="slovotvorSort" aria-label="Порядок слов">
            <span aria-current="true">Топ</span>
            <span>А–Я</span>
            <span>Новые</span>
            <span>Старые</span>
          </nav>
        </div>

        <div className="slovotvorCards">
          {words.map((entry) => (
            <article className="slovotvorCard" key={entry.word}>
              <Link className="slovotvorCardLink" href={`/slovotvor/${entry.slug}`}>
                <div className="slovotvorWordLine">
                  <strong>{entry.word}</strong>
                  <span aria-hidden="true">←</span>
                  <span>{entry.sourceWord}</span>
                </div>
                <div className="slovotvorCardFooter">
                  <span className="slovotvorAuthor">{entry.authorName}</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
