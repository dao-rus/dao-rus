import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentParticipant } from "@/lib/session";

export const metadata: Metadata = { title: "крайнесрок — Словотвор" };

const loginHref = "/api/auth/telegram/start?next=%2Fslovotvor%2Fkraynesrok";

export default async function KraynesrokPage() {
  const participant = await getCurrentParticipant();

  return (
    <main className="shell">
      <article className="card slovotvorWordPage">
        <Link className="slovotvorBackLink" href="/slovotvor">← К списку слов</Link>
        <div className="slovotvorWordHeading">
          <h1>крайнесрок</h1>
          <p>← дедлайн</p>
        </div>
        <p className="slovotvorWordAuthor">Автор: Илья</p>
        <p className="slovotvorWordExplanation">Слово обозначает крайний срок и звучит короче привычного заимствования.</p>

        <section className="slovotvorScoreboard" aria-label="Оценки слова">
          <div className="slovotvorScore slovotvorBetter"><strong>200</strong><span>Лучше</span></div>
          <div className="slovotvorScore slovotvorWorse"><strong>100</strong><span>Хуже</span></div>
        </section>
        <div className="slovotvorVoteActions">
          {participant ? <>
            <button className="button primary" type="button" disabled>Лучше</button>
            <button className="button secondary" type="button" disabled>Хуже</button>
          </> : <>
            <a className="button primary" href={loginHref}>Лучше</a>
            <a className="button secondary" href={loginHref}>Хуже</a>
          </>}
        </div>

        <section className="slovotvorOtherVariants">
          <h2>Другие варианты</h2>
          <div className="slovotvorOtherVariant">
            <strong>срокочерт</strong>
            <span className="slovotvorBetter">+31</span>
            <span className="slovotvorWorse">−8</span>
          </div>
        </section>

        <section className="slovotvorSuggest">
          <h2>Придумай лучше</h2>
          <div className="slovotvorSuggestForm">
            <input type="text" placeholder="Предложи свой вариант" aria-label="Предложи свой вариант" disabled />
            {participant ? <button className="button primary" type="button" disabled>Отправить</button>
              : <a className="button primary" href={loginHref}>Отправить</a>}
          </div>
        </section>
      </article>
    </main>
  );
}
