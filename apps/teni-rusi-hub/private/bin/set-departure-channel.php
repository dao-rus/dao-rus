<?php
declare(strict_types=1);
// Sets departure_channel_id in the private config.php: the closed channel (the departure list of
// the DAO) where the bot adds one line for every person who leaves the hub group.
// Usage: set-departure-channel.php <channel_id>   (the number, -100..., not the @name: the channel is closed)
// The bot must be an administrator of the channel with the right to post. A test line is sent first;
// the configuration is written only if Telegram accepted it. Prints no configuration values.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

$raw = $argv[1] ?? '';
if (!preg_match('/^-100[0-9]{6,13}$/D', $raw)) {
    fwrite(STDERR, "Usage: set-departure-channel.php <channel_id>  (like -1001234567890)\n");
    exit(1);
}
try {
    $file = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $sent = (new \TeniRusi\Telegram($c['bot_token']))->call('sendMessage', ['chat_id' => $raw, 'text' => 'Проверка: сюда бот будет записывать ушедших из группы.']);
    if (empty($sent['ok'])) throw new RuntimeException('Telegram did not accept a message to that channel (is the bot an administrator with the right to post?)');
    $c['departure_channel_id'] = $raw;
    $tmp = tempnam(dirname($file), '.teni-departure-');
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
    if (($check['departure_channel_id'] ?? null) !== $raw) throw new RuntimeException('Verification failed');
    echo "Departure channel set, test line sent. Other configuration values unchanged.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
