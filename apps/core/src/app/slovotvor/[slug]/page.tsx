import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlovotvorWordBySlug, listSlovotvorVariants } from "@/lib/slovotvor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const word = await getSlovotvorWordBySlug((await params).slug);
  return { title: word ? `${word.word} — Словотвор` : "Словотвор" };
}

export default async function SlovotvorWordPage({ params }: { params: Promise<{ slug: string }> }) {
  const word = await getSlovotvorWordBySlug((await params).slug);
  if (!word) notFound();
  const variants = await listSlovotvorVariants(word);

  return (
    <main className="shell">
      <article className="card slovotvorWordPage">
        <Link className="slovotvorBackLink" href="/slovotvor">← К списку слов</Link>
        <div className="slovotvorWordHeading">
          <h1>{word.word}</h1>
          <p>← {word.sourceWord}</p>
        </div>
        <p className="slovotvorWordAuthor">Автор: {word.authorName}</p>
        {word.explanation ? <p className="slovotvorWordExplanation">{word.explanation}</p> : null}
        {variants.length ? <section className="slovotvorOtherVariants">
          <h2>Другие варианты</h2>
          {variants.map((variant) => <div className="slovotvorOtherVariant" key={variant.id}>
            <strong>{variant.word}</strong>
          </div>)}
        </section> : null}
      </article>
    </main>
  );
}
