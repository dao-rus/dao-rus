import type { Metadata } from "next";

export const metadata: Metadata = { title: "Словотвор" };

const words = [
  { word: "крайнесрок", source: "дедлайн", author: "Демонстрационный автор", better: 200, worse: 100 },
  { word: "считало", source: "компьютер", author: "Демонстрационный автор", better: 80, worse: 12 },
  { word: "срокочерт", source: "дедлайн", author: "Демонстрационный автор", better: 31, worse: 8 },
];

export default function SlovotvorPage() {
  return (
    <main className="shell">
      <section className="card slovotvorPage">
        <div className="slovotvorEyebrow">Демонстрационный режим</div>
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
                <span>{entry.source}</span>
              </div>
              <p className="slovotvorAuthor">Автор: {entry.author}</p>
              <div className="slovotvorCardFooter">
                <div className="slovotvorVotes" aria-label={`Лучше ${entry.better}, хуже ${entry.worse}`}>
                  <span className="slovotvorBetter">Лучше +{entry.better}</span>
                  <span className="slovotvorWorse">Хуже −{entry.worse}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
