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
export default async function PollPage({ params, searchParams }: { params: Promise<{ proposalId: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const { proposalId } = await params;
  const [poll, { values: texts }, query] = await Promise.all([getPollView(proposalId), readInterfaceTexts(), searchParams]);
  if (!poll) notFound();
  const canVote = !poll.closedAt && await canVoteInPoll(pool, poll.id, participant.id);
  return <main className="shell"><section className="card profile"><CoreNavigation current="veche" />
    <Link href="/veche">{texts["veche.back"]}</Link>
    {query.outcome ? <p role="status">{texts[query.outcome === "saved" ? "veche.vote_saved" : "veche.vote_failed"]}</p> : null}
    <PollContent poll={poll} texts={texts} canVote={canVote} canClose={!poll.closedAt && !poll.deadline && poll.authorId === participant.id} />
  </section></main>;
}
