import type { PollView, VoteChoice } from "../lib/veche-polls";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { UserText } from "./user-text";
import { LocalDateTime } from "./local-date-time";

// Receives only the safe domain projection; no private ballot is available in this tree.
export function PollContent({ poll, texts, canVote = false, canClose = false }: {
  poll: PollView; texts: InterfaceTextValues; canVote?: boolean; canClose?: boolean;
}) {
  const choiceText = (choice: VoteChoice) => texts[`veche.${choice}`];
  return <section>
    <h1>{poll.title}</h1><UserText text={poll.body} />
    <p>{texts[`veche.${poll.circle}`]} · {texts[`veche.${poll.mode}`]} · {texts[poll.closedAt ? "veche.closed" : "veche.running"]}</p>
    <p>{poll.deadline ? <LocalDateTime value={poll.deadline} /> : texts["veche.permanent"]}</p>
    <p>{texts["veche.turnout"]}: {poll.turnout}</p>
    {!poll.closedAt ? <>
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
    {poll.publicVotes ? <ul>{poll.publicVotes.map(vote => <li key={vote.participantId}>{vote.displayName}: {choiceText(vote.choice)}</li>)}</ul> : null}
  </section>;
}
