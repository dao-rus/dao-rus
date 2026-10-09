import type { PollView, VoteChoice } from "../lib/veche-polls";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { UserText } from "./user-text";
import { LocalDateTime } from "./local-date-time";

// Receives only the safe domain projection; no private ballot is available in this tree.
export function PollContent({ poll, texts, canVote = false, canClose = false, canSign = false, signed = false, canMark = false, marked = false }: {
  poll: PollView; texts: InterfaceTextValues; canVote?: boolean; canClose?: boolean; canSign?: boolean; signed?: boolean; canMark?: boolean; marked?: boolean;
}) {
  const choiceText = (choice: VoteChoice) => texts[`veche.${choice}`];
  return <section>
    <h1>{poll.title}</h1><UserText text={poll.body} />
    <p>{texts[`veche.${poll.circle}`]} · {texts[`veche.${poll.mode}`]} · {texts[poll.call?.state === "collecting" ? "veche.collecting" : poll.call?.state === "not_called" ? "veche.not_called" : poll.closedAt ? "veche.closed" : "veche.running"]}</p>
    <p>{poll.deadline ? <LocalDateTime value={poll.deadline} /> : texts["veche.permanent"]}</p>
    {poll.call ? <section>
      <p>{texts["veche.signature_meaning"]}</p>
      <p>{texts["veche.signature_count"]}: {poll.call.counted} · {texts["veche.signature_required"]}: {poll.call.required}</p>
      <LocalDateTime value={poll.call.deadline} />
      <ul>{poll.call.signatures.map((signer,index) => <li key={signer.participantId ?? index}>{signer.displayName ?? texts["veche.anonymous_participant"]}</li>)}</ul>
      {poll.call.state === "collecting" && (canSign || signed) ? <form action={`/api/veche/${poll.id}/signatures`} method="post">
        <button className="button secondary" name="support" value={signed ? "off" : "on"}>{texts[signed ? "veche.signature_withdraw" : "veche.signature_support"]}</button>
      </form> : null}
    </section> : null}
    {poll.empty ? <section>
      {poll.empty.recognized ? <p role="status">{texts["veche.empty_recognized"]}</p> : null}
      {poll.empty.enabled || poll.empty.marks.length || poll.empty.fraction !== null ? <>
        <p>{texts["veche.empty_count"]}: {poll.empty.marks.length}</p>
        <ul>{poll.empty.marks.map(marker=><li key={marker.participantId}>{marker.displayName}</li>)}</ul>
        {!poll.closedAt && (canMark || marked) ? <form action={`/api/veche/${poll.id}/empty`} method="post">
          <p>{texts["veche.empty_hint"]}</p>
          <button className="button secondary" name="mark" value={marked?"off":"on"}>{texts[marked?"veche.empty_withdraw":"veche.empty_mark"]}</button>
        </form> : null}
      </> : null}
    </section> : null}
    <p>{texts["veche.turnout"]}: {poll.turnout}</p>
    {!poll.closedAt && (!poll.call || poll.call.state === "called") ? <>
      <p>{texts["veche.hidden"]}</p>
      {canVote ? <form action={`/api/veche/${poll.id}`} method="post">
        {(["yes", "no", "abstain"] as const).map(choice => <button className="button secondary" key={choice} name="choice" value={choice}>{choiceText(choice)}</button>)}
      </form> : <p>{texts["veche.ineligible"]}</p>}
      {canClose ? <form action={`/api/veche/${poll.id}`} method="post"><button className="button secondary" name="action" value="close">{texts["veche.close"]}</button></form> : null}
    </> : null}
    {poll.result ? <>
      <ul>{(["yes", "no", "abstain"] as const).map(choice => <li key={choice}>{choiceText(choice)}: {poll.result!.counts[choice]}</li>)}</ul>
      <p>{texts[poll.result.quorumReached ? "veche.quorum_reached" : "veche.quorum_missing"]}</p>
      <p>{texts["veche.eligible"]}: {poll.result.eligible}</p>
    </> : null}
    {poll.publicVotes ? <ul>{poll.publicVotes.map((vote,index) => <li key={vote.participantId ?? index}>{vote.displayName ?? texts["veche.anonymous_participant"]}: {choiceText(vote.choice)}</li>)}</ul> : null}
  </section>;
}
