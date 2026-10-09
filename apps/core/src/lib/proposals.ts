import { normalizePollConfig, type PollConfig } from "./veche-polls";
import { canCreateProposal } from "./eligibility";

export type ProposalStatus = "open";

export type Proposal = {
  id: string;
  authorParticipantId: string;
  title: string;
  body: string;
  status: ProposalStatus;
  createdAt: Date;
};

export type ProposalListItem = Omit<Proposal,"authorParticipantId"> & {
  authorParticipantId: string | null;
  authorDisplayName: string | null;
  hasPoll?: boolean;
};

type ProposalField = "title" | "body";

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type ProposalDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type ProposalDatabase = {
  connect(): Promise<ProposalDatabaseClient>;
};

export class ProposalValidationError extends Error {
  constructor(readonly field: ProposalField) {
    super(`Proposal ${field} must not be empty`);
    this.name = "ProposalValidationError";
  }
}

export class ProposalEligibilityError extends Error {
  constructor() {
    super("Current Participant membership does not allow Proposal creation");
    this.name = "ProposalEligibilityError";
  }
}

function normalizeRequiredText(value: unknown, field: ProposalField): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProposalValidationError(field);
  }

  return value.trim();
}

// The only caller-facing question projection; internal authors never pass through spread rows.
export function publicProposal(row: Record<string,unknown>): ProposalListItem {
 const hidden=row.author_visibility==="anonymous";
 return {id:String(row.id),title:String(row.title),body:String(row.body),status:row.status as ProposalStatus,createdAt:new Date(String(row.created_at)),authorParticipantId:hidden?null:String(row.author_participant_id),authorDisplayName:hidden?null:String(row.author_display_name??""),hasPoll:row.has_poll===true};
}
export function publicParticipant(question:Record<string,unknown>,row:Record<string,unknown>){
 const hidden=question.author_visibility==="anonymous"&&row.participant_id===question.author_participant_id;
 return {participantId:hidden?null:String(row.participant_id),displayName:hidden?null:String(row.display_name)};
}
function proposalFromRow(row: Record<string, unknown>): Proposal {
  return {
    id: String(row.id),
    authorParticipantId: String(row.author_participant_id),
    title: String(row.title),
    body: String(row.body),
    status: row.status as ProposalStatus,
    createdAt: new Date(String(row.created_at)),
  };
}

export async function createProposalWithDatabase(
  database: ProposalDatabase,
  authorParticipantId: string,
  titleValue: unknown,
  bodyValue: unknown,
  poll?: PollConfig,
): Promise<Proposal> {
  const title = normalizeRequiredText(titleValue, "title");
  const body = normalizeRequiredText(bodyValue, "body");
  if (poll) normalizePollConfig(poll);
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const participantResult = await client.query(
      `SELECT membership_status${poll ? ", residence_name" : ""}
         FROM participants
        WHERE id = $1
        FOR ${poll?.paid ? "UPDATE" : "SHARE"}`,
      [authorParticipantId],
    );
    if (
      !participantResult.rowCount ||
      (poll && !String(participantResult.rows[0].residence_name ?? "").trim()) ||
      !canCreateProposal({
        membershipStatus: String(
          participantResult.rows[0].membership_status,
        ),
      })
    ) {
      throw new ProposalEligibilityError();
    }

    const proposalResult = await client.query(
      `INSERT INTO proposals(author_participant_id, title, body, status${poll ? ",poll_circle,poll_city,poll_mode,poll_deadline,poll_call_state,poll_paid,author_visibility" : ""})
       VALUES ($1, $2, $3, 'open'${poll ? ",$4,$5,$6,$7,$8,$9,$10" : ""})
       RETURNING id, author_participant_id, title, body, status, created_at`,
      poll ? [authorParticipantId, title, body, poll.circle, poll.circle === "city" ? String(participantResult.rows[0].residence_name).trim().toLocaleLowerCase("ru-RU") : null, poll.mode, poll.deadline, poll.bySignatures ? "collecting" : null, poll.paid === true, poll.authorVisibility ?? "public"] : [authorParticipantId, title, body],
    );
    const proposal = proposalFromRow(proposalResult.rows[0]);

    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('proposal.created', $1, $2::jsonb)`,
      [
        poll?.authorVisibility === "anonymous" ? null : authorParticipantId,
        JSON.stringify({
          proposal_id: proposal.id,
          title: proposal.title,
        }),
      ],
    );

    await client.query("COMMIT");
    return proposal;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createProposal(
  authorParticipantId: string,
  titleValue: unknown,
  bodyValue: unknown,
): Promise<Proposal> {
  const { pool } = await import("./db");
  return createProposalWithDatabase(pool, authorParticipantId, titleValue, bodyValue);
}

export async function listProposalsWithDatabase(database:Pick<ProposalDatabaseClient,"query">): Promise<ProposalListItem[]> {
  const result = await database.query(
    `SELECT proposals.id,
            proposals.author_participant_id,
            proposals.author_visibility,
            proposals.title,
            proposals.body,
            proposals.status,
            proposals.poll_circle IS NOT NULL AS has_poll,
            proposals.created_at,
            participants.display_name AS author_display_name
       FROM proposals
       JOIN participants ON participants.id = proposals.author_participant_id
      ORDER BY proposals.created_at DESC, proposals.id DESC`,
  );

  return result.rows.map(publicProposal);
}

export async function listProposals(){const {pool}=await import("./db");return listProposalsWithDatabase(pool);}
export async function ownProposalFlags(database:Pick<ProposalDatabaseClient,"query">,id:string,viewerId:string){
 const row=(await database.query("SELECT author_participant_id=$2 AS own,EXISTS(SELECT 1 FROM proposal_signatures WHERE proposal_id=$1 AND participant_id=$2) AS signed FROM proposals WHERE id=$1",[id,viewerId])).rows[0];return {own:row?.own===true,signed:row?.signed===true};
}
