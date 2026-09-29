import Link from "next/link";
import {
  DAO_CODE_CLAUSES,
  DAO_CODE_TITLE,
  DAO_CODE_VERSION,
} from "@/lib/dao-code";

export default function CodePage() {
  return (
    <main className="shell">
      <section className="card codePage">
        <div className="eyebrow">ДАО Русь · Основной документ</div>
        <h1>{DAO_CODE_TITLE}</h1>
        <p className="lead">
          Три базовых принципа, на которых строятся отношения участников и механизмы ДАО Русь.
        </p>
        <p className="muted">Версия {DAO_CODE_VERSION}</p>

        <ol className="codeClauses">
          {DAO_CODE_CLAUSES.map((clause) => (
            <li id={clause.id} key={clause.id}>
              <span aria-hidden="true">{clause.number}</span>
              <p>{clause.text}</p>
            </li>
          ))}
        </ol>

        <section className="codeCommentaryIntro">
          <h2>Комментарий к Кодексу</h2>
          <p>
            Толкования и практика применения будут развиваться отдельным живым слоем.
            Популярность комментария сама по себе не изменяет Кодекс.
          </p>
        </section>

        <div className="actions">
          <Link className="button secondary" href="/">На главную</Link>
        </div>
      </section>
    </main>
  );
}
