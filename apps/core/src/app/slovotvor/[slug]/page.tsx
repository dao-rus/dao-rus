import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlovotvorWordBySlug, listSlovotvorVariants } from "@/lib/slovotvor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const word = await getSlovotvorWordBySlug((await params).slug);
  return { title: word?.word ?? word?.sourceWord ?? "Словотвор" };
}

export default async function SlovotvorWordPage({ params }: { params: Promise<{ slug: string }> }) {
  const word = await getSlovotvorWordBySlug((await params).slug);
  if (!word) notFound();
  const variants = word.sourceWord ? await listSlovotvorVariants(word) : [];
  const hasWords = Boolean(word.word || word.sourceWord);

  return (
    <main className="shell">
      <article className="card slovotvorWordPage">
        <Link className="slovotvorBackLink" href="/slovotvor">← К списку слов</Link>
        <div className="slovotvorWordHeading">
          {word.word ? <h1>{word.word}</h1> : null}
          {word.sourceWord ? <p>← {word.sourceWord}</p> : null}
          {!hasWords && word.explanation ? <p className="slovotvorDescriptionMain">{word.explanation}</p> : null}
        </div>
        <p className="slovotvorWordAuthor">Автор: {word.authorName}</p>
        {hasWords && word.explanation ? <p className="slovotvorWordExplanation">{word.explanation}</p> : null}
        {variants.length ? <section className="slovotvorOtherVariants">
          <h2>Другие варианты</h2>
          {variants.map((variant) => variant.word ? <div className="slovotvorOtherVariant" key={variant.id}>
            <strong>{variant.word}</strong>
          </div> : null)}
        </section> : null}
      </article>
    </main>
  );
}
