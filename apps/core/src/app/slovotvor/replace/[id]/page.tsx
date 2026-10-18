import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlovotvorReplacementRequestById } from "@/lib/slovotvor-replacements";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const request = await getSlovotvorReplacementRequestById((await params).id);
  return { title: request ? `${request.sourceWord} — Словотвор` : "Словотвор" };
}

export default async function SlovotvorReplacementPage({ params }: { params: Promise<{ id: string }> }) {
  const request = await getSlovotvorReplacementRequestById((await params).id);
  if (!request) notFound();

  return (
    <main className="shell">
      <article className="card slovotvorWordPage">
        <Link className="slovotvorBackLink" href="/slovotvor">← К списку слов</Link>
        <div className="slovotvorWordHeading">
          <h1>Предложи заменить</h1>
          <p>{request.sourceWord}</p>
        </div>
        <p className="slovotvorWordAuthor">Автор: {request.authorName}</p>
        <Link
          className="button primary"
          href={`/slovotvor?source=${encodeURIComponent(request.sourceWord)}`}
        >
          Придумать замену
        </Link>
      </article>
    </main>
  );
}
