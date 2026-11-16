<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

final class Hub
{
    // Runtime projection of docs/governance/code.md, version 0.1.
    public const CODE_VERSION = '0.1';
    public const CODE = "1. Не нападай первым.\n2. Стой за свою свободу, уважай чужую. Границы свобод определяют договор и вече.\n3. Власть принадлежит народу.";
    private $clock;
    private Community $community;
    private Network $network;
    private Reputation $reputation;

    public function __construct(private PDO $db, private Bot $bot, private array $config, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn(): int => time();
        $this->reputation = new Reputation($db, $config, $this->clock);
        $this->community = new Community($db, $bot, $config, $this->clock);
        $this->network = new Network($db, $bot, $config, $this->clock, $this->community);
    }

    private function now(): int { return ($this->clock)(); }
    private function query(string $sql, array $params = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($params);
        return $q;
    }

    public static function userId($id): bool
    {
        return is_int($id) && $id > 0 && $id <= 4503599627370495;
    }

    /** All state changes and decision calls for a user's slot share this lock. */
    private function locked(string $userId, callable $work)
    {
        $this->db->beginTransaction();
        try {
            // ON DUPLICATE KEY takes an exclusive record lock. INSERT IGNORE
            // would take shared locks, deadlocking two SELECT FOR UPDATE upgrades.
            $this->query('INSERT INTO trh_slots(hub_id,telegram_user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE latest_update=latest_update',
                [$this->config['hub_id'], $userId]);
            $slot = $this->query('SELECT * FROM trh_slots WHERE hub_id=? AND telegram_user_id=? FOR UPDATE',
                [$this->config['hub_id'], $userId])->fetch();
            $value = $work($slot);
            $this->db->commit();
            return $value;
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    public function receive(array $update): string
    {
        $this->community->remember($update);
        $r = $update['chat_join_request'] ?? null;
        if (is_array($r)) return $this->join($update, $r);
        $cm = $update['chat_member'] ?? null;
        if (is_array($cm)) return $this->community->chatMember($cm);
        $reaction = $update['message_reaction'] ?? $update['message_reaction_count'] ?? null;
        if (is_array($reaction)) return $this->reaction($reaction, isset($update['message_reaction']));
        $cb = $update['callback_query'] ?? null;
        if (is_array($cb)) {
            $data = is_string($cb['data'] ?? null) ? $cb['data'] : '';
            if (str_starts_with($data, 'trh:x:') || str_starts_with($data, 'trh:n:')) return $this->network->callback($cb);
            if (str_starts_with($data, 'trh:o:')) return $this->operatorDecision($cb);
            return $this->callback($cb);
        }
        $m = $update['message'] ?? null;
        if (is_array($m) && ($m['chat']['type'] ?? null) === 'private' &&
            self::userId($m['from']['id'] ?? null) && ($m['from']['is_bot'] ?? false) !== true &&
            ($m['chat']['id'] ?? null) === $m['from']['id'] &&
            is_int($update['update_id'] ?? null) && $update['update_id'] >= 0 &&
            is_int($m['date'] ?? null) && $m['date'] > 0 && $m['date'] <= $this->now() + 60 &&
            is_string($m['text'] ?? null) && ($m['text'] === '/start' || str_starts_with($m['text'], '/start '))) {
            $start = $this->locked((string)$m['from']['id'], function (array $slot) use ($m, $update) {
                // A stale or repeated /start is dropped silently: it must not be answered twice.
                if ($m['date'] < (int)$slot['last_start_date'] || ($m['date'] === (int)$slot['last_start_date'] &&
                    $slot['last_start_update'] !== null && $update['update_id'] <= (int)$slot['last_start_update'])) return null;
                $this->query('UPDATE trh_slots SET last_start_date=?,last_start_update=? WHERE hub_id=? AND telegram_user_id=?',
                    [$m['date'], $update['update_id'], $this->config['hub_id'], (string)$m['from']['id']]);
                return ['id' => $slot['current_request_id']];
            });
            if ($start !== null) {
                $this->network->clearDialog((string)$m['from']['id']);
                $this->startReply((string)$m['chat']['id'], $start['id']);
            }
            return 'start';
        }
        if (is_array($m) && ($m['chat']['type'] ?? null) === 'private' &&
            self::userId($m['from']['id'] ?? null) && ($m['from']['is_bot'] ?? false) !== true &&
            ($m['chat']['id'] ?? null) === $m['from']['id'] && is_int($m['message_id'] ?? null)) {
            $operator = $this->config['operator_chat_id'] ?? null;
            if (self::userId($operator) && $m['from']['id'] === $operator && ($m['text'] ?? null) === '/members') {
                return $this->community->members($operator);
            }
            // A Telegram "Reply" is an answer to a relayed message, never an Exchange record.
            if (!isset($m['reply_to_message'])) {
                // The persistent keyboard and /find, /who, /me, /menu: no /start needed.
                if (is_string($m['text'] ?? null)) {
                    $menu = $this->network->menuAction((string)$m['from']['id'], $m['text']);
                    if ($menu !== null) return $menu;
                }
                $dialog = $this->network->dialogInput($m);
                if ($dialog !== null) return $dialog;
            }
            return $this->relay($m);
        }
        // A message in the hub group: only its number and author are kept, for the reputation counter.
        if (is_array($m)) return $this->counted(fn() => $this->reputation->message($m));
        return 'ignored';
    }

    /**
     * The reputation counter must never hold up the update queue (applications, the reception desk):
     * a storage failure is counted in the poll report and noted in the error log (code only, no data).
     */
    private function counted(callable $work): string
    {
        try {
            return $work();
        } catch (\PDOException $e) {
            error_log('reputation storage error ' . (string)$e->getCode());
            return 'reputation_error';
        }
    }

    /**
     * A reaction in the hub group goes to the reputation counter; the result label is only counted in
     * the polling report (no IDs, names, message IDs or emoji reach the log). Anonymous totals
     * (message_reaction_count) name nobody, so nothing can be counted from them.
     */
    private function reaction(array $r, bool $individual): string
    {
        if ((string)($r['chat']['id'] ?? '') !== $this->config['chat_id']) return 'ignored';
        return $individual ? $this->counted(fn() => $this->reputation->reaction($r)) : 'reaction_count_only';
    }

    /**
     * Operator buttons for a previously excluded applicant who accepted the rules:
     * «Допустить» approves the join request, «Отклонить» declines it.
     */
    private function operatorDecision(array $cb): string
    {
        $operator = $this->config['operator_chat_id'] ?? null;
        if (!is_string($cb['id'] ?? null) || !self::userId($operator) || ($cb['from']['id'] ?? null) !== $operator ||
            !preg_match('/^trh:o:(a|d):([a-f0-9]{32})$/D', (string)$cb['data'], $match)) return 'ignored';
        $initial = $this->row($match[2]);
        $done = $initial ? $this->locked($initial['telegram_user_id'], function (array $slot) use ($match) {
            $r = $this->row($match[2]);
            if (!$r || $slot['current_request_id'] !== $r['id'] || $r['status'] !== 'needs_review' || $r['outcome'] !== 'excluded_review') return null;
            $this->query("UPDATE trh_requests SET status=?,outcome=NULL,retry_at=0 WHERE id=?",
                [$match[1] === 'a' ? 'approval_pending' : 'decline_pending', $r['id']]);
            return $match[1];
        }) : null;
        $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'],
            'text' => $done === null ? 'Заявка уже обработана или недоступна.' : ($done === 'a' ? 'Допущен' : 'Отклонён')]);
        if ($done === null) return 'operator_decision_stale';
        if (is_int($cb['message']['message_id'] ?? null)) {
            $this->bot->call('editMessageText', ['chat_id' => $operator, 'message_id' => $cb['message']['message_id'],
                'text' => (is_string($cb['message']['text'] ?? null) ? $cb['message']['text'] : 'Заявка ранее исключённого') .
                    "\n\nРешение: " . ($done === 'a' ? 'допущен.' : 'отклонён.')]);
        }
        $this->decision($match[2]);
        return 'operator_decision';
    }

    /** Media that carry a caption, so they can reach the operator as one message with the sender line. */
    private const CAPTIONED = ['photo', 'video', 'document', 'audio', 'animation', 'voice'];

    /**
     * Any other private message to the bot goes to the operator, so nothing written to
     * the bot is silently lost. Text arrives as one message with a sender line on top,
     * captioned media as one copy with that line in the caption, anything else (stickers,
     * video notes...) as the line plus a forward. The operator-side message IDs are kept
     * so a Telegram "Reply" from the operator can be delivered back (operatorReply).
     * A failed send to the operator throws: the update is retried (webhook 500 / next poll).
     * If the sender has an open request, the bot may now write to them, so the rules
     * with fresh buttons are sent again.
     */
    private function relay(array $m): string
    {
        $operator = $this->config['operator_chat_id'] ?? null;
        if (!self::userId($operator)) return 'ignored';
        if ($m['from']['id'] === $operator) return $this->operatorReply($m, $operator);
        $name = trim(($m['from']['first_name'] ?? '') . ' ' . ($m['from']['last_name'] ?? ''));
        $who = 'Сообщение боту от: ' . ($name !== '' ? $name : 'без имени') .
            (isset($m['from']['username']) && is_string($m['from']['username']) ? ' (@' . $m['from']['username'] . ')' : '');
        $sender = $m['chat']['id'];
        $ids = [];
        $media = null;
        foreach (self::CAPTIONED as $type) if (isset($m[$type])) { $media = $type; break; }
        $caption = is_string($m['caption'] ?? null) ? $m['caption'] : '';
        if (is_string($m['text'] ?? null) && mb_strlen($who . "\n\n" . $m['text']) <= 4096) {
            $sent = $this->bot->call('sendMessage', ['chat_id' => $operator, 'text' => $who . "\n\n" . $m['text']]);
        } elseif ($media !== null && mb_strlen($who . "\n\n" . $caption) <= 1024) {
            $sent = $this->bot->call('copyMessage', ['chat_id' => $operator, 'from_chat_id' => $sender,
                'message_id' => $m['message_id'], 'caption' => $who . ($caption !== '' ? "\n\n" . $caption : '')]);
        } else {
            $line = $this->bot->call('sendMessage', ['chat_id' => $operator, 'text' => $who]);
            if (is_int($line['result']['message_id'] ?? null)) $ids[] = $line['result']['message_id'];
            $sent = $this->bot->call('forwardMessage', ['chat_id' => $operator, 'from_chat_id' => $sender, 'message_id' => $m['message_id']]);
        }
        if (empty($sent['ok'])) throw new \RuntimeException('Relay to operator failed');
        if (is_int($sent['result']['message_id'] ?? null)) $ids[] = $sent['result']['message_id'];
        foreach ($ids as $operatorMessageId) {
            $this->query('INSERT INTO trh_relays(hub_id,operator_message_id,sender_chat_id,created_at) VALUES (?,?,?,?)',
                [$this->config['hub_id'], $operatorMessageId, (string)$sender, $this->now()]);
        }
        $this->bot->call('sendMessage', ['chat_id' => $sender, 'text' => 'Ваше сообщение передано организаторам хаба.']);
        $slot = $this->query('SELECT current_request_id FROM trh_slots WHERE hub_id=? AND telegram_user_id=?',
            [$this->config['hub_id'], (string)$m['from']['id']])->fetch();
        if ($slot && $slot['current_request_id']) {
            $r = $this->row($slot['current_request_id']);
            if ($r && $r['status'] === 'pending') $this->offer($r['id'], true);
        }
        return 'relayed';
    }

    /**
     * The operator answers by replying (Telegram "Reply") to a message the bot passed on;
     * the reply is copied to that sender, and the operator is told whether it arrived.
     * Anything else from the operator gets a short hint instead of silence.
     */
    private function operatorReply(array $m, int $operator): string
    {
        $replyTo = $m['reply_to_message']['message_id'] ?? null;
        $row = is_int($replyTo) ? $this->query('SELECT sender_chat_id FROM trh_relays WHERE hub_id=? AND operator_message_id=?',
            [$this->config['hub_id'], $replyTo])->fetch() : false;
        if (!$row) {
            $this->bot->call('sendMessage', ['chat_id' => $operator,
                'text' => 'Чтобы ответить человеку, нажмите «Ответить» на его сообщении, которое переслал бот, и напишите ответ.']);
            return 'operator_hint';
        }
        $copy = $this->bot->call('copyMessage', ['chat_id' => $row['sender_chat_id'], 'from_chat_id' => $operator,
            'message_id' => $m['message_id']]);
        $error = (int)($copy['error_code'] ?? 0);
        $text = !empty($copy['ok']) ? 'Доставлено.' : ($error === 403
            ? 'Не доставлено: человек заблокировал бота или удалил чат с ним.'
            : 'Не доставлено: Telegram не принял сообщение' . ($error ? " (код $error)" : '') . '. Попробуйте ещё раз.');
        $this->bot->call('sendMessage', ['chat_id' => $operator, 'text' => $text,
            'reply_parameters' => ['message_id' => $m['message_id'], 'allow_sending_without_reply' => true]]);
        return !empty($copy['ok']) ? 'reply_delivered' : 'reply_failed';
    }

    /**
     * Answers /start in every state so the applicant is never left without a reply.
     * A still-open request gets the rules again; any other state gets one status line.
     */
    private function startReply(string $chatId, ?string $id): void
    {
        $r = $id ? $this->row($id) : null;
        $settled = !$r || in_array($r['status'], ['approved', 'superseded', 'declined'], true);
        // People in the network (hub members or those who accepted the Code in the bot) get its menu.
        if ($settled && $this->network->canUse($chatId)) {
            $this->network->menu($chatId);
            return;
        }
        if ($r && $r['status'] === 'pending') {
            // Resends the rules, or marks an expired request for decline.
            $this->offer($id, true);
            $r = $this->row($id);
            if ($r && $r['status'] === 'pending') return;
            $settled = in_array($r['status'] ?? '', ['approved', 'superseded', 'declined'], true);
        }
        // Anyone else is invited into the network by accepting the Code; no group needed.
        if ($settled && !($r && $r['status'] === 'decline_pending')) {
            $this->network->welcome($chatId);
            return;
        }
        $this->bot->call('sendMessage', ['chat_id' => $chatId, 'text' => self::startStatusText($r)]);
    }

    public static function startStatusText(?array $r): string
    {
        return match ($r['status'] ?? null) {
            'approval_pending' => 'Согласие сохранено. Ждём подтверждения допуска от Telegram — это может занять несколько минут.',
            'decline_pending' => ($r['decision_reason'] ?? null) === 'expired'
                ? 'Срок ответа истёк, заявка будет отклонена. Вы можете подать новую заявку на вступление в группу.'
                : 'Отказ сохранён, заявка будет отклонена. Если передумаете, подайте новую заявку на вступление в группу.',
            'approved' => 'Заявка принята: вы допущены в группу.',
            'declined' => 'Заявка отклонена. Вы можете подать новую заявку на вступление в группу.',
            'needs_review' => ($r['outcome'] ?? null) === 'excluded_review'
                ? 'Согласие сохранено. Ранее вы были исключены из хаба, поэтому заявку рассмотрят организаторы.'
                : 'Заявка требует ручной проверки.',
            default => 'Активной заявки в хаб не найдено. Подайте заявку на вступление в группу заново.',
        };
    }

    private function join(array $update, array $r): string
    {
        if (!is_int($update['update_id'] ?? null) || $update['update_id'] < 0 ||
            !is_int($r['chat']['id'] ?? null) || (string)$r['chat']['id'] !== $this->config['chat_id'] ||
            !self::userId($r['from']['id'] ?? null) || ($r['from']['is_bot'] ?? false) === true ||
            !self::userId($r['user_chat_id'] ?? null) || !is_int($r['date'] ?? null) ||
            $r['date'] <= 0 || $r['date'] > $this->now() + 60) return 'ignored';
        // Only the normal Bot API join-request flow is supported (not a Mini App query).
        if (isset($r['query_id'])) return 'unsupported_join_query';
        $id = $this->locked((string)$r['from']['id'], function (array $slot) use ($r, $update) {
            if ($this->query('SELECT id FROM trh_requests WHERE telegram_update_id=?', [$update['update_id']])->fetch()) return null;
            if ($r['date'] < (int)$slot['latest_date'] ||
                ($r['date'] === (int)$slot['latest_date'] && $update['update_id'] <= (int)$slot['latest_update'])) return null;
            if ($slot['current_request_id']) {
                // Telegram decisions address chat+user, not a request ID. Cancel the
                // old worker intent before accepting any replacement application.
                $this->query("UPDATE trh_requests SET status='superseded',offer_state='none' WHERE id=? AND status IN ('pending','approval_pending','decline_pending','needs_review')",
                    [$slot['current_request_id']]);
            }
            $id = bin2hex(random_bytes(16));
            $this->query('INSERT INTO trh_requests(id,hub_id,telegram_user_id,telegram_update_id,user_chat_id,event_date,expires_at,code_version,offer_due_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [$id, $this->config['hub_id'], (string)$r['from']['id'], $update['update_id'],
                    (string)$r['user_chat_id'], $r['date'], self::expiresAt($r['date'], $this->config['response_seconds']),
                    self::CODE_VERSION, $this->now(), $this->now()]);
            $this->query('UPDATE trh_slots SET current_request_id=?,latest_date=?,latest_update=? WHERE hub_id=? AND telegram_user_id=?',
                [$id, $r['date'], $update['update_id'], $this->config['hub_id'], (string)$r['from']['id']]);
            return $id;
        });
        if (!$id) return 'duplicate_or_stale';
        $excluded = $this->community->excludedAt((string)$r['from']['id']);
        if ($excluded !== null) {
            $this->community->notifyOperator('Заявка от ранее исключённого: ' .
                Community::displayName($this->community->person((string)$r['from']['id'])) . ', исключён ' . Community::date($excluded) .
                '. Ему отправлены правила с пометкой об исключении; если он их примет, решение будет за вами.');
        }
        $this->offer($id);
        return 'recorded';
    }

    private function callback(array $cb): string
    {
        if (!is_string($cb['id'] ?? null) || !self::userId($cb['from']['id'] ?? null) ||
            !is_string($cb['data'] ?? null) || !preg_match('/^trh:(a|r):([a-f0-9]{32})$/D', $cb['data'], $match)) return 'ignored';
        $reviewed = false;
        $accepted = false;
        $message = $this->locked((string)$cb['from']['id'], function (array $slot) use ($match, &$reviewed, &$accepted) {
            $r = $this->query('SELECT * FROM trh_requests WHERE id=? AND hub_id=?',
                [$match[2], $this->config['hub_id']])->fetch();
            if (!$r || $slot['current_request_id'] !== $r['id'] || $slot['telegram_user_id'] !== $r['telegram_user_id'] ||
                $r['status'] !== 'pending' || $r['code_version'] !== self::CODE_VERSION) return 'Заявка уже обработана или недоступна.';
            if ((int)$r['expires_at'] <= $this->now()) {
                $this->expire($r['id']);
                return 'Срок ответа истёк.';
            }
            if ($match[1] === 'r') {
                $this->query("UPDATE trh_requests SET status='decline_pending',decision_reason='refused',offer_state='none' WHERE id=?", [$r['id']]);
                return 'Отказ сохранён. Заявка будет отклонена.';
            }
            // Commit evidence and local hub association BEFORE any Telegram approval.
            $this->query('INSERT INTO trh_consents(request_id,hub_id,telegram_user_id,code_version,accepted_at) VALUES (?,?,?,?,?)',
                [$r['id'], $r['hub_id'], $r['telegram_user_id'], self::CODE_VERSION, $this->now()]);
            $this->query('INSERT INTO trh_memberships(hub_id,telegram_user_id,latest_consent_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE latest_consent_id=VALUES(latest_consent_id)',
                [$r['hub_id'], $r['telegram_user_id'], $r['id']]);
            if ($this->community->excludedAt($r['telegram_user_id']) !== null) {
                // Previously excluded: consent is kept, the operator decides on admission.
                $this->query("UPDATE trh_requests SET status='needs_review',outcome='excluded_review',decision_reason='accepted',accepted_at=?,offer_state='none' WHERE id=?", [$this->now(), $r['id']]);
                $reviewed = true;
                return 'Согласие сохранено. Ранее вы были исключены из хаба, поэтому заявку рассмотрят организаторы.';
            }
            $this->query("UPDATE trh_requests SET status='approval_pending',decision_reason='accepted',accepted_at=?,offer_state='none' WHERE id=?", [$this->now(), $r['id']]);
            $accepted = true;
            return 'Согласие сохранено. Допуск ожидает подтверждения Telegram.';
        });
        // Best-effort UI acknowledgement has no bearing on the durable decision.
        $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $message]);
        $request = $this->row($match[2]);
        if ($reviewed && $request) {
            $excluded = $this->community->excludedAt($request['telegram_user_id']);
            $this->community->notifyOperator('Ранее исключённый ' . Community::displayName($this->community->person($request['telegram_user_id'])) .
                ($excluded !== null ? ' (исключён ' . Community::date($excluded) . ')' : '') . ' принял правила хаба. Допустить в группу?',
                ['reply_markup' => ['inline_keyboard' => [[
                    ['text' => 'Допустить', 'callback_data' => 'trh:o:a:' . $request['id']],
                    ['text' => 'Отклонить', 'callback_data' => 'trh:o:d:' . $request['id']],
                ]]]]);
            return 'handled';
        }
        if ($request && $request['telegram_user_id'] === (string)$cb['from']['id']) $this->decision($match[2]);
        // Once, right after the consent was recorded: what the hub is, what is kept and shown.
        if ($accepted) $this->network->greeting((string)$cb['from']['id']);
        return 'handled';
    }

    private function expire(string $id): void
    {
        $this->query("UPDATE trh_requests SET status='decline_pending',decision_reason='expired',offer_state='none' WHERE id=? AND status='pending'", [$id]);
    }

    private function row(string $id): ?array
    {
        $row = $this->query('SELECT * FROM trh_requests WHERE id=? AND hub_id=?', [$id, $this->config['hub_id']])->fetch();
        return $row ?: null;
    }

    /** Claim delivery durably before sending: a crash/timeout is never auto-replayed. */
    public function offer(string $id, bool $userInitiated = false): void
    {
        $initial = $this->row($id);
        if (!$initial) return;
        $r = $this->locked($initial['telegram_user_id'], function (array $slot) use ($id, $userInitiated) {
            $r = $this->row($id);
            if (!$r || $slot['current_request_id'] !== $id || $r['status'] !== 'pending') return null;
            if ((int)$r['expires_at'] <= $this->now()) { $this->expire($id); return null; }
            if (!$userInitiated && ($r['offer_state'] !== 'queued' || (int)$r['offer_due_at'] > $this->now())) return null;
            $r['offer_target'] = $userInitiated || $this->now() >= (int)$r['event_date'] + 295 ||
                $r['offer_target'] === $r['telegram_user_id'] ? $r['telegram_user_id'] : $r['user_chat_id'];
            $this->query("UPDATE trh_requests SET offer_state='awaiting_start',offer_target=?,offer_attempts=offer_attempts+1 WHERE id=?",
                [$r['offer_target'], $id]);
            return $r;
        });
        if (!$r) return;
        $result = $this->bot->call('sendMessage', $this->offerMessage($r));
        $this->locked($r['telegram_user_id'], function (array $slot) use ($id, $r, $result) {
            $current = $this->row($id);
            if ($slot['current_request_id'] !== $id || !$current || $current['status'] !== 'pending' ||
                (int)$current['offer_attempts'] !== (int)$r['offer_attempts'] + 1) return;
            $state = !empty($result['ok']) ? 'sent' : 'awaiting_start';
            $due = $this->now();
            $target = $r['offer_target'];
            $error = (int)($result['error_code'] ?? 0);
            if (empty($result['ok']) && (int)$current['offer_attempts'] < 5) {
                if ($error === 429) { $state = 'queued'; $due += $this->delay($current['offer_attempts'], $result); }
                elseif (in_array($error, [400, 403], true) && $target !== $r['telegram_user_id']) {
                    $state = 'queued'; $target = $r['telegram_user_id'];
                }
            }
            $this->query('UPDATE trh_requests SET offer_state=?,offer_due_at=?,offer_target=?,error_code=? WHERE id=?',
                [$state, $due, $target, empty($result['ok']) ? 'send_' . $error : null, $id]);
        });
    }

    private function offerMessage(array $r, string $prefix = ''): array
    {
        if ($this->community->excludedAt($r['telegram_user_id']) !== null) {
            $prefix .= "Ранее вы были исключены из хаба. Если вы примете правила, заявку рассмотрят организаторы.\n\n";
        }
        return [
            'chat_id' => $r['offer_target'],
            'text' => $prefix . $this->config['title'] . "\n\n" . self::CODE .
                "\n\nЭто правила общения в хабе. Согласие не означает вступления в ДАО Русь.\n\nВы принимаете эти правила?\n\nЕсли кнопка не отвечает, подождите несколько минут: возможны задержки из-за перебоев в доступе к Telegram",
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => 'Принимаю', 'callback_data' => 'trh:a:' . $r['id']],
                ['text' => 'Не принимаю', 'callback_data' => 'trh:r:' . $r['id']],
            ]]],
        ];
    }

    /** Stored as expires_at when response_seconds is 0: the request never expires. 2100-01-01 UTC. */
    public const NO_EXPIRY = 4102444800;

    public static function expiresAt(int $eventDate, int $responseSeconds): int
    {
        return $responseSeconds === 0 ? self::NO_EXPIRY : $eventDate + $responseSeconds;
    }

    /**
     * Reminders repeat until the applicant answers, blocks the bot or the request expires:
     * every REMIND_EVERY seconds during the first day after the request, every
     * REMIND_EVERY_LATER until REMIND_WEEKLY_AFTER, then every REMIND_EVERY_WEEKLY.
     */
    public const REMIND_EVERY = 14400;
    public const REMIND_DAILY_AFTER = 86400;
    public const REMIND_EVERY_LATER = 43200;
    public const REMIND_WEEKLY_AFTER = 2592000;
    public const REMIND_EVERY_WEEKLY = 604800;

    public static function remindInterval(int $eventDate, int $now): int
    {
        $age = $now - $eventDate;
        if ($age < self::REMIND_DAILY_AFTER) return self::REMIND_EVERY;
        return $age < self::REMIND_WEEKLY_AFTER ? self::REMIND_EVERY_LATER : self::REMIND_EVERY_WEEKLY;
    }

    /** No reminders at night, Moscow time: hours [23:00, 09:00). */
    public function quietHours(): bool
    {
        $hour = (int)gmdate('G', $this->now() + 10800);
        return $hour >= 23 || $hour < 9;
    }

    /**
     * Resends the rules with a reminder header to an applicant who has not answered.
     * The time of the last message is kept in offer_due_at (unused once an offer is sent);
     * it is claimed before sending, so a crash or timeout never produces a burst.
     */
    public function remind(string $id): void
    {
        $initial = $this->row($id);
        if (!$initial) return;
        $r = $this->locked($initial['telegram_user_id'], function (array $slot) use ($id) {
            $r = $this->row($id);
            if (!$r || $slot['current_request_id'] !== $id || $r['status'] !== 'pending' || $r['offer_state'] !== 'sent') return null;
            if ((int)$r['expires_at'] <= $this->now()) { $this->expire($id); return null; }
            if ((int)$r['offer_due_at'] + self::remindInterval((int)$r['event_date'], $this->now()) > $this->now()) return null;
            $this->query('UPDATE trh_requests SET offer_due_at=? WHERE id=?', [$this->now(), $id]);
            return $r;
        });
        if (!$r) return;
        $result = $this->bot->call('sendMessage', $this->offerMessage($r, "Напоминание: ваша заявка в хаб ждёт ответа. Если хотите подумать — не спешите.\n\n"));
        if (empty($result['ok']) && (int)($result['error_code'] ?? 0) === 403) {
            // Telegram refuses: the applicant never started the bot (after the 5-minute join-request
            // window the bot may not write first) or blocked it. Stop reminding; /start resends the rules.
            $this->locked($r['telegram_user_id'], function (array $slot) use ($id) {
                $current = $this->row($id);
                if ($slot['current_request_id'] !== $id || !$current || $current['status'] !== 'pending' || $current['offer_state'] !== 'sent') return;
                $this->query("UPDATE trh_requests SET offer_state='awaiting_start',error_code='remind_403' WHERE id=?", [$id]);
            });
        }
    }

    private function delay(int $attempts, array $result): int
    {
        return max(min(3600, 5 * (2 ** min($attempts, 9))), max(0, (int)($result['parameters']['retry_after'] ?? 0)));
    }

    public function decision(string $id): void
    {
        $initial = $this->row($id);
        if (!$initial) return;
        $this->locked($initial['telegram_user_id'], function (array $slot) use ($id) {
            $r = $this->row($id);
            if (!$r || $slot['current_request_id'] !== $id || (int)$r['retry_at'] > $this->now()) return;
            if ($r['status'] === 'pending' && (int)$r['expires_at'] <= $this->now()) {
                $this->expire($id); $r = $this->row($id);
            }
            if (!in_array($r['status'], ['approval_pending', 'decline_pending'], true)) return;
            $approve = $r['status'] === 'approval_pending';
            if ($approve && !$this->query('SELECT request_id FROM trh_consents WHERE request_id=?', [$id])->fetch()) {
                throw new \RuntimeException('Missing consent');
            }
            $result = $this->bot->call($approve ? 'approveChatJoinRequest' : 'declineChatJoinRequest',
                ['chat_id' => $this->config['chat_id'], 'user_id' => (int)$r['telegram_user_id']]);
            $status = $approve ? 'approved' : 'declined';
            $outcome = 'confirmed';
            if (empty($result['ok'])) {
                $member = $this->bot->call('getChatMember', ['chat_id' => $this->config['chat_id'], 'user_id' => (int)$r['telegram_user_id']]);
                $joined = !empty($member['ok']) && (in_array($member['result']['status'] ?? '', ['member','administrator','creator'], true) ||
                    (($member['result']['status'] ?? '') === 'restricted' && !empty($member['result']['is_member'])));
                $error = (int)($result['error_code'] ?? 0);
                if ($approve && $joined) $outcome = 'already_member';
                elseif (!$approve && $joined) { $status = 'needs_review'; $outcome = 'external_approval'; }
                elseif (!$approve && !empty($member['ok']) && str_contains(strtoupper($result['description'] ?? ''), 'HIDE_REQUESTER_MISSING')) {
                    $outcome = 'already_handled';
                } elseif (($error === 0 || $error === 429 || $error >= 500) && (int)$r['attempts'] < 9) {
                    $this->query('UPDATE trh_requests SET attempts=attempts+1,retry_at=?,error_code=? WHERE id=?',
                        [$this->now() + $this->delay((int)$r['attempts'] + 1, $result), 'decision_' . $error, $id]);
                    return;
                } else { $status = 'needs_review'; $outcome = 'telegram_' . $error; }
            }
            $this->query('UPDATE trh_requests SET status=?,outcome=?,attempts=attempts+1,error_code=NULL WHERE id=?', [$status, $outcome, $id]);
        });
    }

    /** One bounded cron batch. No always-running worker or public cron endpoint. */
    public function tick(int $limit = 20): void
    {
        $rows = $this->query("SELECT id FROM trh_requests WHERE hub_id=? AND ((status='pending' AND (expires_at<=? OR (offer_state='queued' AND offer_due_at<=?))) OR (status IN ('approval_pending','decline_pending') AND retry_at<=?)) ORDER BY created_at LIMIT " . max(1, min(50, $limit)),
            [$this->config['hub_id'], $this->now(), $this->now(), $this->now()])->fetchAll();
        foreach ($rows as $r) { $this->decision($r['id']); $this->offer($r['id']); }
        if ($this->quietHours()) return;
        // Same rule as remindInterval(): frequent during the first day, daily afterwards.
        $now = $this->now();
        $due = $this->query("SELECT id FROM trh_requests WHERE hub_id=? AND offer_state='sent' AND status='pending' AND expires_at>? AND ((offer_due_at<=? AND event_date>?) OR (offer_due_at<=? AND event_date>?) OR offer_due_at<=?) ORDER BY offer_due_at LIMIT " . max(1, min(50, $limit)),
            [$this->config['hub_id'], $now,
                $now - self::REMIND_EVERY, $now - self::REMIND_DAILY_AFTER,
                $now - self::REMIND_EVERY_LATER, $now - self::REMIND_WEEKLY_AFTER,
                $now - self::REMIND_EVERY_WEEKLY])->fetchAll();
        foreach ($due as $r) $this->remind($r['id']);
        $this->network->tick(false);
        $this->counted(fn() => $this->reputationSignals());
    }

    /**
     * Dislikes from at least a third of the group's people over 30 days are a reason to look into a case,
     * never a decision: the operator is told once per person per 30 days, and so is the person. Exclusion
     * is decided by a vote of the people, not by the counter. Quiet hours are respected: tick() returns before this.
     */
    private function reputationSignals(): string
    {
        $candidates = $this->reputation->dislikeCandidates();
        if (!$candidates) return 'no_candidates';
        $count = $this->bot->call('getChatMemberCount', ['chat_id' => $this->config['chat_id']]);
        $members = is_int($count['result'] ?? null) ? $count['result'] : 0;
        if ($members <= 0) return 'members_unknown';
        $need = Reputation::threshold($members);
        $operator = $this->config['operator_chat_id'] ?? null;
        if (!self::userId($operator)) return 'no_operator';
        $signalled = 0;
        foreach ($candidates as $c) {
            $user = (string)$c['author_id'];
            if ((int)$c['people'] < $need || $user === (string)$operator || $this->reputation->alertedRecently($user)) continue;
            $told = $this->bot->call('sendMessage', ['chat_id' => (string)$user, 'text' =>
                "За последние 30 дней под вашими сообщениями в группе набралось много дизлайков от разных людей. Это не решение и не наказание: организаторы посмотрят, в чём дело. " .
                'Если хотите что-то пояснить, напишите сюда, сообщение дойдёт до них.']);
            $sent = $this->bot->call('sendMessage', ['chat_id' => $operator, 'text' =>
                'Сигнал по репутации: ' . Community::displayName($this->community->person($user)) . ' получил дизлайки от ' . (int)$c['people'] .
                " разных людей за 30 дней (порог $need при $members участниках группы). Это повод разобраться, а не решение: исключение решается голосованием. " .
                (!empty($told['ok']) ? 'Человеку об этом написано.' : 'Написать человеку бот не смог (он не запускал бота).')]);
            // Only a delivered signal is remembered: otherwise the next tick tries again.
            if (!empty($sent['ok'])) { $this->reputation->markAlerted($user, (int)$c['people']); $signalled++; }
        }
        return 'signals_' . $signalled;
    }
}
