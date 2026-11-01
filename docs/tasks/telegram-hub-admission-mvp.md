# Telegram hub admission — implementation task (MVP)

Status: approved for implementation; **not deployed**.

## Goal
Reuse the existing Telegram Guardian/Reception infrastructure to admit applicants to a private Telegram discussion group (initial test: DAO Core test; later "Хаб Тени Руси — ДАО Русь"). The hub is an independent peripheral entry point, **not DAO membership**.

## Required flow
1. Receive Telegram `chat_join_request` for a configured hub chat.
2. Immediately offer the applicant the canonical three rules from `docs/governance/code.md` (do not paraphrase). Offer "Принимаю" / "Не принимаю".
3. On acceptance, look up the Core user by Telegram ID; create a minimal **unverified, non-member** account only if absent. Never downgrade an existing account.
4. Persist hub association, acceptance timestamp and Code version; avoid duplicate accounts or acceptances.
5. Only after successful persistence, approve the Telegram join request.
6. On refusal, decline the request. After **24 hours** without response, decline if still pending; permit a fresh application. Expiry is not a Code refusal.
7. Handle Telegram's short-lived `user_chat_id` contact window (roughly 5 minutes): send immediately and provide a fallback deep link to a normal bot DM, with secure binding to the original request.
8. Reconcile approval failures, repeated callbacks, duplicate updates, already-processed requests and DB errors safely.

## Architecture
- First inspect existing Reception webhook, Guardian bot, worker, Core user identity and membership, Code handling, and migration/test patterns.
- Reuse the existing bot/infrastructure. Do not create a second bot, identity system or service.
- Hub configuration must be reusable for future hubs ("Русь Ислам", "Звездолёт Земля"); do not hard-code group names.
- Keep hub participation separate from DAO membership and verification.
- Respect current Code text, especially rule 2 ending "Границы свобод определяют договор и вече." and rule 3 "Власть принадлежит народу."
- Limit bot privileges to required Telegram administration permissions.
- Keep secrets and personal identifiers out of logs.

## Tests / acceptance
- Applicant acceptance, refusal, expiry at 24h and reapplication.
- Existing Core user vs new unverified non-member user.
- Duplicate requests/updates/callbacks, stale or invalid callback.
- Telegram cannot DM; fallback via bot deep link.
- Core DB failure does not approve membership.
- Telegram approval failure can be retried/reconciled.
- Regression tests for existing Guardian message handling and Reception flow.
- Test the linked channel's "Комментировать" entry path before production rollout.

## Delivery
Implement minimal code and migration, run existing checks and tests, report changed files, test outcomes, permissions, migration/deploy procedure, and manual Telegram configuration steps. **Do not deploy production or change live Telegram group/channel settings without explicit authorization.** Avoid unrelated refactors, Mini App, reputation, needs matrix, mass invites.
