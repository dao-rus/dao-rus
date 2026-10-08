# Awards v0.1

The normative source is `docs/governance/charters/awards.md` at repository root.
Awards are independent of DARUS, reputation, verification and governance weights.

`award-access.ts` is the sole institutional policy. The configured Founder can
establish an immutable Award, prepare batches and finalize them. Technical admin
access alone grants none of these capabilities. Historical authors are stored as
Participant UUIDs, independently of the current policy.

`participant-audience.ts` owns shared profile filters. The Guardian wrapper keeps
its existing forum/login and active membership restrictions. Awards search existing
human Participants, including profiles without a Core login and departed members.
Filters aid manual review; they do not establish entitlement. Applying filters adds
snapshot candidates without changing existing exclusions, notes or sources.

Batch mutations lock the parent draft. Finalization locks the batch and Award,
checks every included candidate, creates all offers and seals the batch in one
transaction. Retries return the same instances. Database guards freeze finalized
lists and reject incomplete releases at commit. Existing instances keep a nullable
batch reference; unique Award + Participant still prohibits repeat awards, including
after rejection and through remint. Remint is available only for historical Awards
and records actual current action dates.

PNG/JPEG/WebP uploads are decoded with a pixel and size limit, stripped of metadata
and stored as PNG plus a separate 48px preview in the immutable Award row. Public
image routes serve only those bytes; external image fetching is not used.

An offer reaches its recipient in two independent ways. Automatically: on a finalized
batch the Founder can notify recipients (`notifyAwardBatchRecipientsWithDatabase`). It
locks the batch, skips anyone who has already answered or already has this offer's
notice, and writes one inbox notice with a Telegram delivery per remaining recipient in
the same transaction, so double clicks and retries never duplicate and a failure leaves
nothing half-sent. The notice carries only the public award name and a link to the
personal offer; reason and personal address are never put in it. By link: the public
page `/awards/<slug>` can be handed to everyone at once. It identifies the visitor by
session, selects only that visitor's own instance and shows the accept/decline dialog
when one exists; a visitor without an offer sees exactly the public page, so the link
reveals nothing about who was or was not offered the award. A guest gets a login that
returns to the same page (`safeAuthReturnPath` allows `/awards/<slug>` only).

Offer UUIDs are addresses, not authorization tokens. The personal page checks the
session and selects only the recipient's instance. Login returns only to an allowed
internal path. Recipient POST routes derive the actor from the session and enforce
same-origin protection. Final rejection additionally requires explicit confirmation.

Public lists select only accepted list opt-ins; nickname badges select only accepted
name opt-ins. Private reasons, addresses and refusal history stay in recipient and
authorized Founder views. Badges are loaded once for all names on a page and passed
to `ParticipantName`; that component never queries the database.

Run the real PostgreSQL tests with `AWARDS_TEST_DATABASE_URL` pointing exclusively
to `postgresql://postgres@127.0.0.1:<port>/awards_tests`. The tests create and remove
their own schema. Never use production fixtures for award tests.
