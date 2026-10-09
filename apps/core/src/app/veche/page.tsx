import { pool } from "@/lib/db";
import { readSignatureSettings } from "@/lib/veche-signatures";
import { SignatureCallForm } from "@/components/signature-call-form";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { getAwardBadges } from "@/lib/award-views";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { CoreNavigation } from "../../components/core-navigation";
import { ParticipantName } from "../../components/participant-name";
import { canCreateProposal } from "@/lib/eligibility";
import { listProposals } from "@/lib/proposals";
import { getParticipantIndicators } from "../../lib/participant-indicators";
import { getCurrentParticipant } from "@/lib/session";
import { UserText } from "../../components/user-text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вече" };

type ProposalsPageProps = {
  searchParams: Promise<{ proposal_create?: string; call?: string }>;
};

const createMessages: Record<string, string> = {
  created: "Предложение создано.",
  empty_title: "Введите непустой заголовок.",
  empty_body: "Введите непустой текст предложения.",
  not_eligible: "Создавать предложения может только действующий участник ДАО.",
};

export default async function ProposalsPage({ searchParams }: ProposalsPageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const [params, proposals, { values: texts }] = await Promise.all([searchParams, listProposals(), readInterfaceTexts()]);
  const indicators = await getParticipantIndicators([...new Set(proposals.map((proposal) => proposal.authorParticipantId))]);
  const badges = await getAwardBadges(proposals.map(p => p.authorParticipantId));
  const createMessage = params.proposal_create
    ? createMessages[params.proposal_create]
    : null;
  const hasError = params.proposal_create
    ? params.proposal_create.startsWith("empty_") ||
      params.proposal_create === "not_eligible"
    : false;
  const proposalCreationAllowed = canCreateProposal(participant);
  const [signatureSettings, callAuthor] = await Promise.all([readSignatureSettings(pool), pool.query("SELECT btrim(COALESCE(residence_name,''))<>'' AS has_city FROM participants WHERE id=$1", [participant.id])]);

  return (
    <main className="shell">
      <section className="card proposalsPage">
        <CoreNavigation current="veche" />
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Governance · Proposal v0.1</div>
            <h1>Вече</h1>
            <p className="muted">Простые открытые предложения участников ДАО.</p>
          </div>
        </div>

        {params.call === "failed" ? <p className="formError">{texts["veche.call_failed"]}</p> : null}
        {proposalCreationAllowed && callAuthor.rows[0]?.has_city ? <SignatureCallForm texts={texts} settings={signatureSettings} /> : null}
        {proposalCreationAllowed ? (
          <form className="proposalForm" action="/api/proposals" method="post">
            <label htmlFor="proposal-title">Заголовок</label>
            <input id="proposal-title" name="title" required />

            <label htmlFor="proposal-body">Текст предложения</label>
            <textarea id="proposal-body" name="body" rows={6} required />

            <button className="button primary" type="submit">
              Создать предложение
            </button>

            {createMessage ? (
              <p className={hasError ? "formError" : "formNotice"}>
                {createMessage}
              </p>
            ) : null}
          </form>
        ) : (
          <p className="formNotice">
            Создавать предложения может только действующий участник ДАО.
          </p>
        )}

        {hasPrototypeAdminAccess(participant.id) ? <Link href="/admin/veche">{texts["veche.settings"]}</Link> : null}
        <section className="proposalList">
          <h2>Все предложения</h2>
          {proposals.length ? (
            <ol>
              {proposals.map((proposal) => (
                <li key={proposal.id}>
                  <div className="proposalMeta">
                    <ParticipantName participantId={proposal.authorParticipantId}
                      verificationPoints={indicators.get(proposal.authorParticipantId)?.verificationPoints ?? 0}
                      positiveCount={indicators.get(proposal.authorParticipantId)?.positiveCount ?? 0}
                      awardBadges={badges[proposal.authorParticipantId]}>{proposal.authorDisplayName}</ParticipantName>
                    <span>
                      <LocalDateTime value={proposal.createdAt.toISOString()} />
                    </span>
                    {proposal.hasPoll ? <Link href={`/veche/${proposal.id}`}>{texts["veche.title"]}</Link> : <span>Статус: открыто</span>}
                  </div>
                  <h3>{proposal.title}</h3>
                  <UserText text={proposal.body} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Предложений пока нет.</p>
          )}
        </section>
      </section>
    </main>
  );
}
