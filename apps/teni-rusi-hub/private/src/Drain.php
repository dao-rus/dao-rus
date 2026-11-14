<?php
declare(strict_types=1);
namespace TeniRusi;

/**
 * Manual recovery when Telegram cannot reach the webhook.
 * Temporarily removes the webhook (pending updates are kept), fetches the queued
 * updates with getUpdates, hands each one to the same handler webhook.php uses,
 * then registers the same webhook again. Hub handling is idempotent, so an update
 * that is seen twice (here and later via the webhook) is harmless.
 * Reports contain only counts and update types: no IDs, texts, tokens or URLs.
 */
final class Drain
{
    public const ALLOWED_UPDATES = ['chat_join_request', 'callback_query', 'message'];

    /** @var callable(string, array, int): ?array  Bot API call; null when no usable response. */
    private $api;
    /** @var callable(array): string */
    private $receive;
    /** @var callable(): float */
    private $clock;

    public function __construct(callable $api, private array $config, callable $receive, ?callable $clock = null)
    {
        $this->api = $api;
        $this->receive = $receive;
        $this->clock = $clock ?? static fn(): float => microtime(true);
    }

    private function call(string $method, array $params = [], int $timeout = 15): ?array
    {
        return ($this->api)($method, $params, $timeout);
    }

    /** Webhook state without the URL itself; null when Telegram did not answer. */
    public function status(): ?array
    {
        $info = $this->call('getWebhookInfo');
        if (empty($info['ok']) || !is_array($info['result'] ?? null)) return null;
        $r = $info['result'];
        $url = (string)($r['url'] ?? '');
        return [
            'url_matches' => $url !== '' && $url === $this->config['webhook_url'],
            'url_empty' => $url === '',
            'pending' => (int)($r['pending_update_count'] ?? 0),
            'last_error_date' => isset($r['last_error_date']) ? (int)$r['last_error_date'] : null,
            'last_error_message' => preg_replace('~https?://\S+~', '<url>', (string)($r['last_error_message'] ?? '')),
        ];
    }

    /** Registers the configured webhook again; verified through getWebhookInfo. */
    public function restore(int $attempts = 3): bool
    {
        for ($i = 0; $i < $attempts; $i++) {
            $this->call('setWebhook', [
                'url' => $this->config['webhook_url'],
                'secret_token' => $this->config['webhook_secret'],
                'allowed_updates' => self::ALLOWED_UPDATES,
                'drop_pending_updates' => false,
            ], 20);
            $s = $this->status();
            if ($s !== null && $s['url_matches']) return true;
        }
        return false;
    }

    /** For a webhook left empty by an interrupted drain; never replaces a foreign webhook. */
    public function restoreIfEmpty(): string
    {
        $s = $this->status();
        if ($s === null) return 'telegram_unreachable';
        if ($s['url_matches']) return 'already_set';
        if (!$s['url_empty']) return 'webhook_not_ours_no_changes';
        return $this->restore() ? 'restored' : 'not_restored';
    }

    public function drain(int $seconds = 60, int $maxUpdates = 500): array
    {
        $report = ['outcome' => null, 'pending_before' => null, 'processed' => 0, 'results' => [],
            'stopped' => null, 'acknowledged' => null, 'restored' => null];
        $before = $this->status();
        if ($before === null) return ['outcome' => 'telegram_unreachable_no_changes'] + $report;
        $report['pending_before'] = $before['pending'];
        if (!$before['url_matches']) return ['outcome' => 'webhook_not_ours_no_changes'] + $report;
        if ($before['pending'] === 0) return ['outcome' => 'queue_empty_no_changes'] + $report;

        $deleted = $this->call('deleteWebhook', ['drop_pending_updates' => false]);
        if (empty($deleted['ok'])) {
            $now = $this->status();
            if ($now !== null && $now['url_matches']) return ['outcome' => 'delete_failed_no_changes'] + $report;
            // State unclear: fall through, try to fetch, and always restore below.
        }
        $report['outcome'] = 'drained';
        try {
            $offset = null;
            $deadline = ($this->clock)() + $seconds;
            while (($this->clock)() < $deadline && $report['processed'] < $maxUpdates) {
                $params = ['limit' => 100, 'timeout' => 0, 'allowed_updates' => self::ALLOWED_UPDATES];
                if ($offset !== null) $params['offset'] = $offset;
                $batch = $this->call('getUpdates', $params, 20);
                if (empty($batch['ok']) || !is_array($batch['result'] ?? null)) { $report['stopped'] = 'get_updates_failed'; break; }
                if ($batch['result'] === []) { $report['stopped'] = 'queue_empty'; break; }
                foreach ($batch['result'] as $update) {
                    if (!is_array($update) || !is_int($update['update_id'] ?? null) || $update['update_id'] < 0) {
                        $report['stopped'] = 'malformed_update'; break 2;
                    }
                    try {
                        $result = (string)($this->receive)($update);
                    } catch (\Throwable $e) {
                        // Not acknowledged: Telegram keeps it and redelivers via the webhook.
                        $report['stopped'] = 'processing_failed'; break 2;
                    }
                    $offset = $update['update_id'] + 1;
                    $report['processed']++;
                    $type = 'other';
                    foreach (self::ALLOWED_UPDATES as $t) if (isset($update[$t])) { $type = $t; break; }
                    $key = $type . ':' . $result;
                    $report['results'][$key] = ($report['results'][$key] ?? 0) + 1;
                }
            }
            if ($report['stopped'] === null) $report['stopped'] = 'limit_reached';
            if ($offset !== null) {
                // Confirms everything processed; anything newer stays queued for the webhook.
                $ack = $this->call('getUpdates', ['offset' => $offset, 'limit' => 1, 'timeout' => 0,
                    'allowed_updates' => self::ALLOWED_UPDATES], 20);
                $report['acknowledged'] = !empty($ack['ok']);
            }
        } finally {
            $report['restored'] = $this->restore();
        }
        return $report;
    }
}
