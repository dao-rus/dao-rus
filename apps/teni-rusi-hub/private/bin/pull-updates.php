<?php
declare(strict_types=1);
// Manual recovery for updates stuck behind failing webhook delivery.
//   --check    read-only: webhook state and a 7-day summary of requests (default)
//   --drain    take queued updates directly (getUpdates), process them, restore the webhook
//   --restore  re-register the webhook if an interrupted drain left it empty
// CLI only. Never prints tokens, secrets, webhook URLs, user IDs or message texts.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
require_once dirname(__DIR__) . '/src/Drain.php';

function msk(?int $unix): ?string
{
    return $unix === null || $unix <= 0 ? null : gmdate('Y-m-d H:i:s', $unix + 10800) . ' MSK';
}

function line(array $data): void
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE), "\n";
}

$mode = $argv[1] ?? '--check';
if (!in_array($mode, ['--check', '--drain', '--restore'], true)) {
    fwrite(STDERR, "Usage: pull-updates.php [--check|--drain|--restore]\n");
    exit(1);
}

try {
    $c = \TeniRusi\configuration();
    if (!\TeniRusi\activationReady($c)) throw new RuntimeException('Hub is disabled or activation is incomplete');
    $token = $c['bot_token'];
    $api = static function (string $method, array $params, int $timeout) use ($token): ?array {
        $curl = curl_init('https://api.telegram.org/bot' . $token . '/' . $method);
        if ($curl === false) return null;
        curl_setopt_array($curl, [
            CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($params === [] ? new stdClass() : $params, JSON_THROW_ON_ERROR),
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $raw = curl_exec($curl);
        curl_close($curl);
        if (!is_string($raw)) return null;
        try { $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); }
        catch (JsonException $e) { return null; }
        return is_array($data) ? $data : null;
    };
    $db = \TeniRusi\database($c);
    $hub = new \TeniRusi\Hub($db, new \TeniRusi\Telegram($token), $c);
    $drain = new \TeniRusi\Drain($api, $c, static fn(array $u): string => $hub->receive($u));

    if ($mode === '--check') {
        $s = $drain->status();
        line(['webhook' => $s === null ? 'telegram_unreachable' : [
            'set_to_hub' => $s['url_matches'], 'empty' => $s['url_empty'], 'pending' => $s['pending'],
            'last_error' => msk($s['last_error_date']), 'last_error_message' => $s['last_error_message'],
        ]]);
        $rows = $db->prepare('SELECT status, offer_state, error_code, COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest
            FROM trh_requests WHERE hub_id=? AND created_at>=? GROUP BY status, offer_state, error_code ORDER BY newest DESC');
        $rows->execute([$c['hub_id'], time() - 7 * 86400]);
        foreach ($rows->fetchAll() as $r) {
            line(['requests_7d' => ['status' => $r['status'], 'offer_state' => $r['offer_state'], 'error_code' => $r['error_code'],
                'count' => (int)$r['n'], 'oldest' => msk((int)$r['oldest']), 'newest' => msk((int)$r['newest'])]]);
        }
        exit(0);
    }
    if ($mode === '--restore') {
        $outcome = $drain->restoreIfEmpty();
        line(['restore' => $outcome]);
        exit(in_array($outcome, ['restored', 'already_set'], true) ? 0 : 2);
    }
    $report = $drain->drain();
    line(['drain' => $report]);
    if ($report['restored'] === false) {
        fwrite(STDERR, "WEBHOOK NOT RESTORED. Run: pull-updates.php --restore\n");
        exit(2);
    }
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . " (no secrets logged)\n");
    exit(1);
}
