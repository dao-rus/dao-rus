<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
try {
    foreach (['pdo_mysql','curl','json','openssl'] as $ext) {
        if (!extension_loaded($ext)) throw new \RuntimeException('Required PHP extension unavailable');
    }
    $c = \TeniRusi\configuration();
    $db = \TeniRusi\database($c);
    foreach (['trh_slots','trh_requests','trh_consents','trh_memberships','trh_relays'] as $t) $db->query('SELECT 1 FROM ' . $t . ' LIMIT 1');
    $engines = $db->query("SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('trh_slots','trh_requests','trh_consents','trh_memberships','trh_relays')")->fetchAll(\PDO::FETCH_COLUMN);
    if (count($engines) !== 5 || count(array_filter($engines, static fn($e) => $e === 'InnoDB')) !== 5) throw new \RuntimeException('InnoDB required');
    echo "PHP/database/tables: OK\n";
    if (!in_array('--telegram', $argv, true)) exit(0);
    if (!$c['bot_token'] || !$c['expected_bot_id']) throw new \RuntimeException('Bot is not configured');
    $bot = new \TeniRusi\Telegram($c['bot_token']);
    $me = $bot->call('getMe', []);
    if (empty($me['ok']) || (string)($me['result']['id'] ?? '') !== $c['expected_bot_id']) throw new \RuntimeException('Bot identity mismatch');
    $chat = $bot->call('getChat', ['chat_id' => $c['chat_id']]);
    $member = $bot->call('getChatMember', ['chat_id' => $c['chat_id'], 'user_id' => (int)$c['expected_bot_id']]);
    if (empty($chat['ok']) || (string)($chat['result']['id'] ?? '') !== $c['chat_id'] ||
        ($member['result']['status'] ?? '') !== 'administrator' || empty($member['result']['can_invite_users'])) throw new \RuntimeException('Chat access or invite permission unavailable');
    echo "Bot identity/chat access/can_invite_users: OK\n";
    $webhook = $bot->call('getWebhookInfo', []);
    if (empty($webhook['ok'])) throw new \RuntimeException('Webhook status unavailable');
    $conflict = !empty($webhook['result']['url']) && $webhook['result']['url'] !== ($c['webhook_url'] ?? '');
    // Report only readiness booleans/counts; URLs and Telegram error text may contain secrets.
    echo json_encode(['webhook_set' => !empty($webhook['result']['url']),
        'allowed_updates' => $webhook['result']['allowed_updates'] ?? [],
        'pending_update_count' => $webhook['result']['pending_update_count'] ?? null,
        'webhook_conflict' => $conflict,
        'has_delivery_error' => isset($webhook['result']['last_error_date'])], JSON_THROW_ON_ERROR) . "\n";
    if ($conflict) { fwrite(STDERR, "Existing webhook belongs elsewhere. Stop; do not replace it.\n"); exit(1); }
} catch (\Throwable $e) { fwrite(STDERR, "Preflight failed. Check PHP extensions, private configuration, MySQL and bot access. No settings changed.\n"); exit(1); }
