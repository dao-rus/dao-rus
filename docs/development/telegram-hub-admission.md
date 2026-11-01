# Telegram hub admission (MVP)

The existing Reception bot handles hub join requests using the same webhook and
`notification-worker`; this feature does not create another bot or imply DAO
membership. Each hub is configured in `telegram_hubs` with a stable slug, chat
ID, canonical Code version and response timeout (24 hours by default).

The request's Telegram update ID is unique. The accepted association is stored
in `telegram_hub_memberships`; new Participants are created through the existing
Telegram identity resolver and keep `membership_status='none'`. Acceptance and
hub association commit before Telegram approval. Failed Telegram approval stays
`approval_pending` and is retried by the existing worker. Refused and expired
requests are reconciled as declines. Expiry is recorded as `expired`, separate
from an explicit refusal, and releases the pending-request uniqueness constraint
so a fresh application can be made.

## Test-only setup

Use an isolated local PostgreSQL database named `reception_tests` and set
`HUB_ADMISSION_TEST_DATABASE_URL` to its loopback connection URL. The integration
test applies every migration inside a unique temporary schema and drops it after
the run. Never point this variable at production.

## Manual rollout checklist (not performed by this implementation)

1. Create or convert the intended discussion group to private, then attach it
   to the public channel so its **Комментировать** link opens the linked group.
2. Add the existing Reception/Guardian bot as an administrator with only
   `can_invite_users` enabled for join-request receipt and approval. No message
   moderation or member restriction rights are needed.
3. After the normal application deploy and migration, insert a row in
   `telegram_hubs` with a stable slug, actual numeric group chat ID, title and
   current `DAO_CODE_VERSION` (`0.1`). Keep response timeout at 24 hours unless
   the configured hub needs a different period.
4. Update that bot's webhook `allowed_updates` to include `message`,
   `chat_member`, `chat_join_request` and `callback_query`, preserving the
   existing webhook URL and secret. The runtime uses the existing Reception
   bot token and username. This task does not call Telegram or change webhook
   settings.
5. Add a direct bot link with `/start hub` to the channel's entry instructions so
   an applicant who could not receive the immediate private message can reopen
   their pending request from a normal bot dialog.
6. Manually verify the channel's **Комментировать** path, acceptance, refusal,
   private-message fallback via `/start hub`, expiration, and an already-joined
   applicant before enabling a production hub.

The hub onboarding itself only records group participation and Code acceptance.
It does not add a verification root, assign DAO membership, or alter existing
participant identity or rights.
