import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { CoreNavigation } from "@/components/core-navigation";
import { PollContent } from "@/components/poll-content";
import { getCurrentParticipant } from "@/lib/session";
import { getPollView, canVoteInPoll } from "@/lib/veche-polls";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { pool } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function generateMetadata() { const { values } = await readInterfaceTexts(); return { title: values["veche.title"] }; }
export default async function PollPage({ params, searchParams }: { params: Promise<{ proposalId: string }>; searchParams: Promise<{ outcome?: string; signature?: string }> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const { proposalId } = await params;
  const [poll, { values: texts }, query] = await Promise.all([getPollView(proposalId), readInterfaceTexts(), searchParams]);
  if (!poll) notFound();
  const signatureEligible = poll.call?.state === "collecting" && (await pool.query("SELECT veche_eligible(member,p.poll_circle,p.poll_city) AS eligible FROM proposals p,participants member WHERE p.id=$1 AND member.id=$2", [poll.id, participant.id])).rows[0]?.eligible === true;
  const signed = poll.call?.signatures.some(signer => signer.participantId === participant.id) ?? false;
  const canVote = !poll.closedAt && await canVoteInPoll(pool, poll.id, participant.id);
  return <main className="shell"><section className="card profile"><CoreNavigation current="veche" />
    <Link href="/veche">{texts["veche.back"]}</Link>
    {query.outcome ? <p role="status">{texts[query.outcome === "saved" ? "veche.vote_saved" : "veche.vote_failed"]}</p> : null}
    {query.signature ? <p role="status">{texts[query.signature === "saved" ? "veche.signature_saved" : "veche.signature_failed"]}</p> : null}
    <PollContent poll={poll} texts={texts} canVote={canVote} canSign={signatureEligible} signed={signed} canClose={!poll.closedAt && !poll.deadline && (!poll.call || poll.call.state === "called") && poll.authorId === participant.id} />
  </section></main>;
}
