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

    public function __construct(private PDO $db, private Bot $bot, private array $config, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn(): int => time();
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
        $r = $update['chat_join_request'] ?? null;
        if (is_array($r)) return $this->join($update, $r);
        $cb = $update['callback_query'] ?? null;
        if (is_array($cb)) return $this->callback($cb);
        $m = $update['message'] ?? null;
        if (is_array($m) && ($m['chat']['type'] ?? null) === 'private' &&
            self::userId($m['from']['id'] ?? null) && ($m['from']['is_bot'] ?? false) !== true &&
            ($m['chat']['id'] ?? null) === $m['from']['id'] &&
            is_int($update['update_id'] ?? null) && $update['update_id'] >= 0 &&
            is_int($m['date'] ?? null) && $m['date'] > 0 && $m['date'] <= $this->now() + 60 &&
            in_array($m['text'] ?? '', ['/start', '/start hub', '/start hub_teni_rusi'], true)) {
            $id = $this->locked((string)$m['from']['id'], function (array $slot) use ($m, $update) {
                if ($m['date'] < (int)$slot['last_start_date'] || ($m['date'] === (int)$slot['last_start_date'] &&
                    $slot['last_start_update'] !== null && $update['update_id'] <= (int)$slot['last_start_update'])) return null;
                $this->query('UPDATE trh_slots SET last_start_date=?,last_start_update=? WHERE hub_id=? AND telegram_user_id=?',
                    [$m['date'], $update['update_id'], $this->config['hub_id'], (string)$m['from']['id']]);
                return $slot['current_request_id'];
            });
            if ($id) $this->offer($id, true);
            return 'start';
        }
        return 'ignored';
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
                    (string)$r['user_chat_id'], $r['date'], $r['date'] + $this->config['response_seconds'],
                    self::CODE_VERSION, $this->now(), $this->now()]);
            $this->query('UPDATE trh_slots SET current_request_id=?,latest_date=?,latest_update=? WHERE hub_id=? AND telegram_user_id=?',
                [$id, $r['date'], $update['update_id'], $this->config['hub_id'], (string)$r['from']['id']]);
            return $id;
        });
        if (!$id) return 'duplicate_or_stale';
        $this->offer($id);
        return 'recorded';
    }

    private function callback(array $cb): string
    {
        if (!is_string($cb['id'] ?? null) || !self::userId($cb['from']['id'] ?? null) ||
            !is_string($cb['data'] ?? null) || !preg_match('/^trh:(a|r):([a-f0-9]{32})$/D', $cb['data'], $match)) return 'ignored';
        $message = $this->locked((string)$cb['from']['id'], function (array $slot) use ($match) {
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
            $this->query("UPDATE trh_requests SET status='approval_pending',decision_reason='accepted',accepted_at=?,offer_state='none' WHERE id=?", [$this->now(), $r['id']]);
            return 'Согласие сохранено. Допуск ожидает подтверждения Telegram.';
        });
        // Best-effort UI acknowledgement has no bearing on the durable decision.
        $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $message]);
        $request = $this->row($match[2]);
        if ($request && $request['telegram_user_id'] === (string)$cb['from']['id']) $this->decision($match[2]);
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
        $result = $this->bot->call('sendMessage', [
            'chat_id' => $r['offer_target'],
            'text' => $this->config['title'] . "\n\n" . self::CODE .
                "\n\nЭто правила общения в хабе. Согласие не означает вступления в ДАО Русь.\n\nВы принимаете эти правила?\n\nЖдем ответа до " . gmdate('d.m.Y H:i', (int)$r['expires_at']) . ' UTC. Если кнопка не отвечает, подождите несколько минут или нажмите /start hub',
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => 'Принимаю', 'callback_data' => 'trh:a:' . $id],
                ['text' => 'Не принимаю', 'callback_data' => 'trh:r:' . $id],
            ]]],
        ]);
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
    }
}
