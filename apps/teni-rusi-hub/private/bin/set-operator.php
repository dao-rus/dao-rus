<?php
declare(strict_types=1);
// Sets operator_chat_id in the private config.php: the Telegram user who receives
// private messages sent to the bot. Usage: set-operator.php <telegram_user_id>
// Writes atomically with mode 0600. Prints no configuration values.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

$raw = $argv[1] ?? '';
if (!preg_match('/^[1-9][0-9]{0,15}$/D', $raw) || !\TeniRusi\Hub::userId((int)$raw)) {
    fwrite(STDERR, "Usage: set-operator.php <telegram_user_id>  (a positive integer)\n");
    exit(1);
}
try {
    $file = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $c['operator_chat_id'] = (int)$raw;
    $tmp = tempnam(dirname($file), '.teni-operator-');
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
    if (($check['operator_chat_id'] ?? null) !== (int)$raw) throw new RuntimeException('Verification failed');
    echo "Operator set. Other configuration values unchanged.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
