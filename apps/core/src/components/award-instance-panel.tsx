"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AwardInstance, AwardInstanceAction } from "../lib/awards";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { LocalDateTime } from "./local-date-time";
import { UserText } from "./user-text";

type Action = AwardInstanceAction | "visibility";
type Feedback = { action: Action; error?: "unauthorized" | "forbidden" | "not_found" | "state" | "invalid" | "network" };
type InstanceResponse = Omit<AwardInstance, "offeredAt" | "declinedAt" | "acceptedAt" | "rejectedAt"> & {
  offeredAt: string; declinedAt: string | null; acceptedAt: string | null; rejectedAt: string | null;
};

// Same progressive form / JSON pattern as SignalForm; one lock for all actions on an instance.
function useAwardSubmission(initial: AwardInstance) {
  const router = useRouter();
  const [instance, setInstance] = useState(initial);
  const [pending, setPending] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>, action: Action) {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    data.set("instanceId", instance.id); data.set("action", action);
    inFlight.current = true; setPending(action); setFeedback(null);
    try {
      const response = await fetch("/api/awards/instances", {
        method: "POST", body: data, headers: { Accept: "application/json" }, credentials: "same-origin",
      });
      if (!response.ok) {
        const errors = { 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "state", 400: "invalid" } as const;
        setFeedback({ action, error: errors[response.status as keyof typeof errors] ?? "network" });
        return null;
      }
      const result = await response.json() as { instance?: InstanceResponse };
      if (!result.instance || result.instance.id !== instance.id) throw new Error("Invalid award response");
      const updated: AwardInstance = { ...result.instance,
        offeredAt: new Date(result.instance.offeredAt),
        declinedAt: result.instance.declinedAt ? new Date(result.instance.declinedAt) : null,
        acceptedAt: result.instance.acceptedAt ? new Date(result.instance.acceptedAt) : null,
        rejectedAt: result.instance.rejectedAt ? new Date(result.instance.rejectedAt) : null,
      };
      setInstance(updated); setFeedback({ action });
      // Refresh server projections (profile badges/public list), preserving client state and scroll.
      router.refresh();
      return updated;
    } catch {
      setFeedback({ action, error: "network" });
      return null;
    } finally { inFlight.current = false; setPending(null); }
  }
  return { instance, pending, feedback, submit, clearFeedback: () => setFeedback(null) };
}
type Submission = ReturnType<typeof useAwardSubmission>;

function FeedbackMessage({ feedback, texts }: { feedback: Feedback | null; texts: InterfaceTextValues }) {
  if (!feedback) return null;
  const success = { visibility: "award.visibility_saved", accept: "award.accept_saved", decline: "award.decline_saved", reject: "award.reject_saved" } as const;
  const failure = { unauthorized: "award.session_expired", forbidden: "award.action_forbidden", not_found: "award.offer_unavailable",
    state: "award.action_state", invalid: "award.action_invalid", network: "award.action_error" } as const;
  return <p className={feedback.error ? "formError" : "formNotice"} role={feedback.error ? "alert" : "status"}>
    {texts[feedback.error ? failure[feedback.error] : success[feedback.action]]}
  </p>;
}

function VisibilityControls({ submission, texts, profile = false }: {
  submission: Submission; texts: InterfaceTextValues; profile?: boolean;
}) {
  const { instance, pending, feedback } = submission;
  const [publicList, setPublicList] = useState(instance.showInPublicList);
  const [nextToName, setNextToName] = useState(instance.showNextToName);
  if (instance.status !== "accepted") return null;
  return <form action="/api/awards/instances" method="post" className="awardForm" aria-busy={pending === "visibility"}
    onSubmit={async event => {
      const updated = await submission.submit(event, "visibility");
      if (updated) { setPublicList(updated.showInPublicList); setNextToName(updated.showNextToName); }
    }}>
    <input type="hidden" name="instanceId" value={instance.id}/><input type="hidden" name="action" value="visibility"/>
    {profile ? <input type="hidden" name="returnTo" value="profile"/> : null}
    <label><input type="checkbox" name="showInPublicList" checked={publicList} disabled={pending !== null}
      onChange={event => { setPublicList(event.target.checked); submission.clearFeedback(); }}/>{texts["award.showInPublicList"]}</label>
    <label><input type="checkbox" name="showNextToName" checked={nextToName} disabled={pending !== null}
      onChange={event => { setNextToName(event.target.checked); submission.clearFeedback(); }}/>{texts["award.showNextToName"]}</label>
    <button type="submit" className="button secondary" disabled={pending !== null}>
      {pending === "visibility" ? texts["award.saving"] : texts["award.save"]}
    </button>
    <FeedbackMessage feedback={feedback?.action === "visibility" ? feedback : null} texts={texts}/>
  </form>;
}

export function AwardVisibilityForm({ instance, texts, profile = false }: {
  instance: AwardInstance; texts: InterfaceTextValues; profile?: boolean;
}) {
  const submission = useAwardSubmission(instance);
  return <VisibilityControls submission={submission} texts={texts} profile={profile}/>;
}

// Shared by the personal offer and the recipient's own panel on a public Award page.
export function AwardInstancePanel({ instance: initial, awarderName, texts }: {
  instance: AwardInstance; awarderName: string; texts: InterfaceTextValues;
}) {
  const submission = useAwardSubmission(initial);
  const { instance, pending, feedback } = submission;
  return <>
    <p>{texts[`award.${instance.status}`]}</p><p>{texts["award.awarder"]}: {awarderName}</p>
    <h2>{texts["award.reason"]}</h2><UserText text={instance.reason}/>
    {instance.personalAddress ? <><h2>{texts["award.personalAddress"]}</h2><UserText text={instance.personalAddress}/></> : null}
    {(["offeredAt", "declinedAt", "acceptedAt", "rejectedAt"] as const).map(key => instance[key] ? <p key={key}>{texts[`award.${key}`]}: <LocalDateTime value={instance[key]!.toISOString()}/></p> : null)}
    <div className="awardActions" aria-busy={pending !== null && pending !== "visibility"}>
      {instance.status === "offered" || instance.status === "declined" ? <div className="actions">
        {(["accept", ...(instance.status === "offered" ? ["decline"] : [])] as AwardInstanceAction[]).map(action => <form key={action}
          action="/api/awards/instances" method="post" onSubmit={event => submission.submit(event, action)}>
          <input type="hidden" name="instanceId" value={instance.id}/><input type="hidden" name="action" value={action}/>
          <button type="submit" className={`button ${action === "accept" ? "primary" : "secondary"}`} disabled={pending !== null}>
            {pending === action ? texts["award.processing"] : texts[`award.${action}`]}
          </button>
        </form>)}
      </div> : null}
      <FeedbackMessage feedback={feedback && feedback.action !== "visibility" && feedback.action !== "reject" ? feedback : null} texts={texts}/>
    </div>
    {instance.status === "accepted" ? <VisibilityControls submission={submission} texts={texts}/> : null}
    {instance.status === "accepted" ? <details><summary>{texts["award.reject"]}</summary><p>{texts["award.rejectWarning"]}</p>
      <form action="/api/awards/instances" method="post" onSubmit={event => submission.submit(event, "reject")}>
        <input type="hidden" name="instanceId" value={instance.id}/><input type="hidden" name="action" value="reject"/>
        <label><input type="checkbox" name="confirm" required disabled={pending !== null}/>{texts["award.rejectConfirm"]}</label>
        <button type="submit" className="button secondary" disabled={pending !== null}>{pending === "reject" ? texts["award.processing"] : texts["award.reject"]}</button>
        <FeedbackMessage feedback={feedback?.action === "reject" && feedback.error ? feedback : null} texts={texts}/>
      </form></details> : null}
    <FeedbackMessage feedback={feedback?.action === "reject" && !feedback.error ? feedback : null} texts={texts}/>
  </>;
}
