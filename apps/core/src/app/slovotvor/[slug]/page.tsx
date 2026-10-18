import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlovotvorVoteSummary, getSlovotvorWordById, getSlovotvorWordBySlug, listSlovotvorVariants } from "@/lib/slovotvor";
import { getCurrentParticipant } from "@/lib/session";
import { appBaseUrl } from "@/lib/config";
import { SlovotvorShareAction } from "./share-action";

export const dynamic = "force-dynamic";

function VoteThumb({ direction }: { direction: "up" | "down" }) {
  return <svg className="slovotvorVoteIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === "up" ? <><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" /></> : <><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" /></>}
  </svg>;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const word = await getSlovotvorWordBySlug((await params).slug);
  return { title: word?.word ?? word?.sourceWord ?? "Словотвор" };
}

export default async function SlovotvorWordPage({ params }: { params: Promise<{ slug: string }> }) {
  const word = await getSlovotvorWordBySlug((await params).slug);
  if (!word) notFound();
  const participant = await getCurrentParticipant();
  const isTask = !word.word && Boolean(word.sourceWord || word.explanation);
  const [variants, votes, parentWord] = await Promise.all([
    isTask ? listSlovotvorVariants(word) : Promise.resolve([]),
    word.word ? getSlovotvorVoteSummary(word.id, participant?.id) : Promise.resolve({ better: 0, worse: 0, ownVote: null }),
    word.parentId ? getSlovotvorWordById(word.parentId) : Promise.resolve(null),
  ]);
  const loginHref = `/api/auth/telegram/start?next=${encodeURIComponent(`/slovotvor/${word.slug}`)}`;
  const shareUrl = new URL(`/slovotvor/${word.slug}`, appBaseUrl()).toString();

  return (
    <main className="shell">
      <article className="card slovotvorWordPage">
        <Link className="slovotvorBackLink" href="/slovotvor">← На главную</Link>
        <div className="slovotvorWordHeading">
          {word.word ? <h1>{word.word}</h1> : null}
          {!word.word && word.sourceWord ? <h1>{word.sourceWord}</h1> : null}
          {word.word && word.sourceWord ? <p className="slovotvorSourceWord">← {word.sourceWord}</p> : null}
          {!word.word && word.sourceWord ? <p className="slovotvorTaskPrompt">Придумай лучше!</p> : null}
          {!word.word && word.explanation ? <p className="slovotvorDescriptionMain">{word.explanation}</p> : null}
        </div>
        {word.explanation && (word.word || word.sourceWord) ? <p className="slovotvorWordExplanation">{word.explanation}</p> : null}
        {!word.word ? <>
          <Link className="slovotvorTaskAction" href={`/slovotvor?parent=${encodeURIComponent(word.id)}`}>
            {word.sourceWord ? "Предложить замену" : "Предложить название"}
          </Link>
          <section className="slovotvorOtherVariants">
            <h2>Предложенные варианты</h2>
            {variants.length ? <div className="slovotvorVariantList">
              {variants.map((variant) => <Link className="slovotvorVariantLink" key={variant.id} href={`/slovotvor/${variant.slug}`}>
                <div className="slovotvorVariantMain">
                  <strong>{variant.word}</strong>
                  <span className="slovotvorAuthor">{variant.authorName}</span>
                </div>
                <div className="slovotvorCardVotes" aria-label="Оценки">
                  <span className="slovotvorBetter" title="Удачное слово" aria-label={`Удачное слово: ${variant.betterVotes}`}><VoteThumb direction="up" />{variant.betterVotes}</span>
                  <span className="slovotvorWorse" title="Неудачное слово" aria-label={`Неудачное слово: ${variant.worseVotes}`}><VoteThumb direction="down" />{variant.worseVotes}</span>
                </div>
              </Link>)}
            </div> : <p className="slovotvorNoVariants">Пока нет предложений. Можно стать первым</p>}
          </section>
        </> : null}
        {word.word ? <section className="slovotvorVoting" aria-label="Оценка слова">
          <p className="slovotvorVotingQuestion">Удачное слово?</p>
          <div className="slovotvorVoteActions">
            {participant ? <>
              <form action="/api/slovotvor/vote" method="post">
                <input type="hidden" name="wordId" value={word.id} />
                <button className="button secondary slovotvorVoteButton" type="submit" name="choice" value="better" aria-label="Удачное слово" title="Удачное слово" aria-pressed={votes.ownVote === "better"}><VoteThumb direction="up" /><span>{votes.better}</span></button>
              </form>
              <form action="/api/slovotvor/vote" method="post">
                <input type="hidden" name="wordId" value={word.id} />
                <button className="button secondary slovotvorVoteButton" type="submit" name="choice" value="worse" aria-label="Неудачное слово" title="Неудачное слово" aria-pressed={votes.ownVote === "worse"}><VoteThumb direction="down" /><span>{votes.worse}</span></button>
              </form>
            </> : <>
              <a className="button secondary slovotvorVoteButton" href={loginHref} aria-label="Удачное слово" title="Удачное слово"><VoteThumb direction="up" /><span>{votes.better}</span></a>
              <a className="button secondary slovotvorVoteButton" href={loginHref} aria-label="Неудачное слово" title="Неудачное слово"><VoteThumb direction="down" /><span>{votes.worse}</span></a>
            </>}
          </div>
        </section> : null}
        {parentWord ? <Link className="slovotvorParentLink" href={`/slovotvor/${parentWord.slug}`}>← К исходному заданию</Link> : null}
        <div className="slovotvorWordFooter">
          <SlovotvorShareAction url={shareUrl} />
          <Link className="slovotvorWordAuthor" href={`/slovotvor?author=${encodeURIComponent(word.authorId)}`}>
            {word.authorName}
          </Link>
        </div>
      </article>
    </main>
  );
}
