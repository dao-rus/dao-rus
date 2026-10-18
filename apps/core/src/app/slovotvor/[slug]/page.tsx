import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlovotvorVoteSummary, getSlovotvorWordBySlug, listSlovotvorVariants } from "@/lib/slovotvor";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const word = await getSlovotvorWordBySlug((await params).slug);
  return { title: word?.word ?? word?.sourceWord ?? "Словотвор" };
}

export default async function SlovotvorWordPage({ params }: { params: Promise<{ slug: string }> }) {
  const word = await getSlovotvorWordBySlug((await params).slug);
  if (!word) notFound();
  const participant = await getCurrentParticipant();
  const [variants, votes] = await Promise.all([
    word.sourceWord ? listSlovotvorVariants(word) : Promise.resolve([]),
    word.word ? getSlovotvorVoteSummary(word.id, participant?.id) : Promise.resolve({ better: 0, worse: 0, ownVote: null }),
  ]);
  const hasWords = Boolean(word.word || word.sourceWord);
  const loginHref = `/api/auth/telegram/start?next=${encodeURIComponent(`/slovotvor/${word.slug}`)}`;

  return (
    <main className="shell">
      <article className="card slovotvorWordPage">
        <Link className="slovotvorBackLink" href="/slovotvor">← На главную</Link>
        <div className="slovotvorWordHeading">
          {word.word ? <h1>{word.word}</h1> : null}
          {word.sourceWord ? <p>← {word.sourceWord}</p> : null}
          {!hasWords && word.explanation ? <p className="slovotvorDescriptionMain">{word.explanation}</p> : null}
        </div>
        {hasWords && word.explanation ? <p className="slovotvorWordExplanation">{word.explanation}</p> : null}
        {word.word ? <section className="slovotvorVoting" aria-label="Оценка слова">
          <div className="slovotvorScoreboard">
            <div className="slovotvorScore slovotvorBetter">
              <strong>{votes.better}</strong>
              <span>Лучше</span>
            </div>
            <div className="slovotvorScore slovotvorWorse">
              <strong>{votes.worse}</strong>
              <span>Хуже</span>
            </div>
          </div>
          <div className="slovotvorVoteActions">
            {participant ? <>
              <form action="/api/slovotvor/vote" method="post">
                <input type="hidden" name="wordId" value={word.id} />
                <button className="button secondary slovotvorVoteButton" type="submit" name="choice" value="better" aria-pressed={votes.ownVote === "better"}>Лучше</button>
              </form>
              <form action="/api/slovotvor/vote" method="post">
                <input type="hidden" name="wordId" value={word.id} />
                <button className="button secondary slovotvorVoteButton" type="submit" name="choice" value="worse" aria-pressed={votes.ownVote === "worse"}>Хуже</button>
              </form>
            </> : <>
              <a className="button secondary slovotvorVoteButton" href={loginHref}>Лучше</a>
              <a className="button secondary slovotvorVoteButton" href={loginHref}>Хуже</a>
            </>}
          </div>
        </section> : null}
        {variants.length ? <section className="slovotvorOtherVariants">
          <h2>Другие варианты</h2>
          {variants.map((variant) => variant.word ? <div className="slovotvorOtherVariant" key={variant.id}>
            <strong>{variant.word}</strong>
          </div> : null)}
        </section> : null}
        <p className="slovotvorWordAuthor">{word.authorName}</p>
      </article>
    </main>
  );
}
