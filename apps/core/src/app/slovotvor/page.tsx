import type { Metadata } from "next";
import Link from "next/link";
import { listSlovotvorWords } from "@/lib/slovotvor";

export const metadata: Metadata = { title: "Словотвор" };
export const dynamic = "force-dynamic";

export default async function SlovotvorPage() {
  const words = await listSlovotvorWords();
  return (
    <main className="shell">
      <section className="card slovotvorPage">
        <h1>Словотвор</h1>
        <p className="lead">Придумай лучше</p>

        <form className="slovotvorForm">
          <div className="slovotvorWordFields">
            <input name="word" type="text" placeholder="Новое слово" aria-label="Новое слово" disabled />
            <input name="source" type="text" placeholder="Вместо какого?" aria-label="Вместо какого?" disabled />
          </div>
          <label>
            Пояснение <span className="muted">(необязательно)</span>
            <textarea name="explanation" placeholder="Почему это слово подходит?" rows={3} disabled />
          </label>
          <button className="button primary" type="button" disabled>Выпустить слово</button>
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
              <div className="slovotvorWordLine">
                <strong>{entry.word}</strong>
                <span aria-hidden="true">←</span>
                <span>{entry.sourceWord}</span>
              </div>
              <p className="slovotvorAuthor">Автор: {entry.authorName}</p>
              <div className="slovotvorCardFooter">
                <Link className="slovotvorCardLink" href={`/slovotvor/${entry.slug}`}>Открыть карточку</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
