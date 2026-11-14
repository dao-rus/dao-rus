<?php
declare(strict_types=1);
// Sets how long an applicant has to answer the rules (response_seconds in config.php).
// Usage: set-response-days.php <days 1..30> [--extend-pending]
//   --extend-pending  also moves the deadline of requests still waiting for an answer
//                     to request time + the new window (never shortens a deadline).
// Writes config atomically with mode 0600. Prints counts only.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

$days = $argv[1] ?? '';
$extend = ($argv[2] ?? '') === '--extend-pending';
if (!preg_match('/^([1-9]|[12][0-9]|30)$/D', $days) || (isset($argv[2]) && !$extend)) {
    fwrite(STDERR, "Usage: set-response-days.php <days 1..30> [--extend-pending]\n");
    exit(1);
}
$seconds = (int)$days * 86400;
try {
    $file = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $c['response_seconds'] = $seconds;
    $tmp = tempnam(dirname($file), '.teni-window-');
    if ($tmp === false) throw new RuntimeException('Cannot create temporary configuration');
    try {
        if (!chmod($tmp, 0600)) throw new RuntimeException('Cannot secure temporary configuration');
        $data = "<?php\ndeclare(strict_types=1);\nreturn " . var_export($c, true) . ";\n";
        if (file_put_contents($tmp, $data, LOCK_EX) !== strlen($data)) throw new RuntimeException('Cannot write configuration');
        if (!rename($tmp, $file)) throw new RuntimeException('Cannot replace configuration');
    } finally {
        if (is_file($tmp)) unlink($tmp);
    }
    $check = \TeniRusi\configuration();
    if (($check['response_seconds'] ?? null) !== $seconds) throw new RuntimeException('Verification failed');
    echo "Response window set to {$days} day(s) for new requests. Other configuration values unchanged.\n";
    if ($extend) {
        $db = \TeniRusi\database($check);
        $st = $db->prepare("UPDATE trh_requests SET expires_at=event_date+? WHERE hub_id=? AND status='pending' AND expires_at>? AND event_date+?>expires_at");
        $st->execute([$seconds, $check['hub_id'], time(), $seconds]);
        echo 'Pending requests extended: ' . $st->rowCount() . "\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
