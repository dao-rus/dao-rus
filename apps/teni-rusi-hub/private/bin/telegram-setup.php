<?php
declare(strict_types=1);
// One-time, CLI-only handover for the existing @Daorus_bot to the Teni Rusi hub.
// Install outside public www: teni-rusi-hub-private/bin/telegram-setup.php.
// Never print Telegram tokens, secret values or webhook URLs.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

function requestTelegram(string $token, string $method, array $params = []): array
{
    $curl = curl_init('https://api.telegram.org/bot' . $token . '/' . $method);
    if ($curl === false) throw new RuntimeException('Telegram HTTP initialization failed');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($params, JSON_THROW_ON_ERROR),
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $raw = curl_exec($curl);
    curl_close($curl);
    if (!is_string($raw)) throw new RuntimeException('Telegram HTTP request failed');
    $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($data) || ($data['ok'] ?? false) !== true) {
        throw new RuntimeException('Telegram rejected a request (' . $method . ')');
    }
    return $data;
}

function writeConfig(string $path, array $config): void
{
    $tmp = tempnam(dirname($path), '.teni-setup-');
    if ($tmp === false) throw new RuntimeException('Cannot create temporary private configuration');
    try {
        if (!chmod($tmp, 0600)) throw new RuntimeException('Cannot secure temporary configuration');
        $data = "<?php\ndeclare(strict_types=1);\nreturn " . var_export($config, true) . ";\n";
        if (file_put_contents($tmp, $data, LOCK_EX) !== strlen($data)) {
            throw new RuntimeException('Cannot write private configuration');
        }
        if (!rename($tmp, $path)) throw new RuntimeException('Cannot replace private configuration');
    } finally {
        if (is_file($tmp)) unlink($tmp);
    }
}

try {
    foreach (['curl', 'pdo_mysql', 'json', 'openssl'] as $extension) {
        if (!extension_loaded($extension)) throw new RuntimeException('Required PHP extension missing');
    }
    $configFile = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $url = $c['webhook_url'] ?? '';
    if ($url !== 'https://dao.h1n.ru/webhook.php') throw new RuntimeException('Unexpected webhook URL');
    $token = $c['bot_token'] ?? '';
    $botId = $c['expected_bot_id'] ?? '';
    if (!is_string($token) || !preg_match('/^[1-9][0-9]*:[A-Za-z0-9_-]+$/D', $token) ||
        !is_string($botId) || $botId !== explode(':', $token, 2)[0]) {
        throw new RuntimeException('Invalid bot token or expected bot ID');
    }
    $db = \TeniRusi\database($c);
    foreach (['trh_slots', 'trh_requests', 'trh_consents', 'trh_memberships'] as $table) {
        $db->query('SELECT 1 FROM ' . $table . ' LIMIT 1');
    }
    echo "Database ready.\n";
    $me = requestTelegram($token, 'getMe');
    if ((string)($me['result']['id'] ?? '') !== $botId ||
        strcasecmp((string)($me['result']['username'] ?? ''), 'Daorus_bot') !== 0) {
        throw new RuntimeException('Bot identity does not match @Daorus_bot');
    }
    $member = requestTelegram($token, 'getChatMember', [
        'chat_id' => $c['chat_id'], 'user_id' => (int)$botId,
    ]);
    if (($member['result']['status'] ?? '') !== 'administrator' ||
        empty($member['result']['can_invite_users'])) {
        throw new RuntimeException('Bot must be group administrator with invite permission');
    }
    echo "Bot identity and group permissions ready.\n";
    $current = requestTelegram($token, 'getWebhookInfo');
    $existingUrl = (string)($current['result']['url'] ?? '');
    if ($existingUrl !== '' && $existingUrl !== $url) {
        $host = strtolower((string)parse_url($existingUrl, PHP_URL_HOST));
        if ($host !== 'daorus.org' && !str_ends_with($host, '.daorus.org')) {
            throw new RuntimeException('Existing webhook is on an unexpected host; stopped without changes');
        }
    }
    if (\TeniRusi\activationReady($c)) {
        if ($existingUrl === $url) {
            echo "Already active on HostiMan. No changes made.\n";
            exit(0);
        }
        throw new RuntimeException('Hub is active but Telegram points elsewhere; manual review needed');
    }
    if (($c['enabled'] ?? false) || ($c['exclusive_bot_confirmed'] ?? false)) {
        throw new RuntimeException('Partially enabled configuration; manual review needed');
    }
    if (!preg_match('/^[A-Za-z0-9_-]{32,256}$/D', (string)($c['webhook_secret'] ?? ''))) {
        $c['webhook_secret'] = bin2hex(random_bytes(32));
    }
    $c['enabled'] = true;
    $c['exclusive_bot_confirmed'] = true;
    if (!\TeniRusi\activationReady($c)) throw new RuntimeException('Invalid activation configuration');
    // Application becomes ready BEFORE Telegram begins delivering updates.
    writeConfig($configFile, $c);
    echo "Private configuration activated. Registering webhook...\n";
    try {
        requestTelegram($token, 'setWebhook', [
            'url' => $url,
            'secret_token' => $c['webhook_secret'],
            'allowed_updates' => ['chat_join_request', 'callback_query', 'message'],
            'drop_pending_updates' => false,
        ]);
    } catch (Throwable $error) {
        // No definitive confirmation of the webhook state. Leave the endpoint
        // ready rather than disabling a possibly registered webhook.
        throw new RuntimeException('Webhook registration unconfirmed. Inspect before retrying');
    }
    $after = requestTelegram($token, 'getWebhookInfo');
    if (($after['result']['url'] ?? null) !== $url) {
        throw new RuntimeException('Webhook verification failed; manual review needed');
    }
    echo "SUCCESS: Telegram webhook transferred to HostiMan.\n";
    echo "Create a recurring worker cron, then disable/remove this one-time setup job.\n";
} catch (Throwable $error) {
    // Do not reveal API responses, tokens, SQL text or server filesystem details.
    fwrite(STDERR, 'Setup stopped: ' . $error->getMessage() . "\n");
    exit(1);
}
