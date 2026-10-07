import { getAwardBadges } from "@/lib/award-views";
import Link from "next/link";
import type { Metadata } from "next";
import { CodeDiscussion } from "../../components/code-discussion";
import { CoreNavigation } from "../../components/core-navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { DAO_CODE_CLAUSES, DAO_CODE_TITLE, DAO_CODE_VERSION } from "../../lib/dao-code";
import { listCodeComments, parseCodeSort, parseCodeSection } from "../../lib/code-comments";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Кодекс руси" };

type CodePageProps = { searchParams: Promise<{ sort?: string; section?: string }> };

export default async function CodePage({ searchParams }: CodePageProps) {
  const [viewer, params] = await Promise.all([getCurrentParticipant(), searchParams]);
  const sort = parseCodeSort(params.sort);
  let openSection: string | null = null;
  try { openSection = parseCodeSection(params.section); } catch { /* All discussions start collapsed. */ }
  const rawComments = await listCodeComments(viewer?.id ?? null);
  const badges = await getAwardBadges(rawComments.map(c => c.authorId));
  const comments = rawComments.map(c => ({...c, awardBadges: badges[c.authorId]}));
  const isAdmin = viewer ? hasPrototypeAdminAccess(viewer.id) : false;

  return (
    <main className="shell">
      <section className="card codePage">
        {viewer ? <CoreNavigation current="code" /> : null}
        <div className="eyebrow">ДАО Русь · Основной документ</div>
        <h1>{DAO_CODE_TITLE}</h1>
        <p className="lead">Три базовых принципа, на которых строятся отношения участников и механизмы ДАО Русь.</p>
        <p className="muted">Версия {DAO_CODE_VERSION}</p>

        <ol className="codeClauses">
          {DAO_CODE_CLAUSES.map((clause) => (
            <li id={clause.id} key={clause.id}>
              <span className="codeClauseNumber" aria-hidden="true">{clause.number}</span>
              <div className="codeClauseContent">
                <p>{clause.text}</p>
                <CodeDiscussion section={clause.id} comments={comments} sort={sort}
                  viewerId={viewer?.id ?? null} isAdmin={isAdmin}
                  initiallyOpen={openSection === clause.id} />
              </div>
            </li>
          ))}
        </ol>

        <section className="codeCommentaryIntro" id="dao-code-all">
          <h2>Кодекс в целом</h2>
          <p>Толкования и практика применения образуют отдельный живой слой. Популярность комментария сама по себе не изменяет Кодекс.</p>
          <CodeDiscussion section="dao-code-all" comments={comments} sort={sort}
            viewerId={viewer?.id ?? null} isAdmin={isAdmin}
            initiallyOpen={openSection === "dao-code-all"} />
        </section>

        <div className="actions">
          <Link className="button secondary" href="/">На главную</Link>
        </div>
      </section>
    </main>
  );
}
