<?php
declare(strict_types=1);
// Adds (or replaces) one extra group in the private config.php: another chat whose reputation counter and
// departure list the bot keeps separately (its own counters, not mixed with the hub group).
// Usage: set-extra-group.php <key> <chat_id> <title...>
//   key     short Latin name used in operator commands, e.g. dao   (/left dao)
//   chat_id the chat number like -1001234567890
//   title   how the group is called in the bot's texts, e.g. Чат ДАО
// The bot must be an administrator of the chat (to see reactions and departures).
// Writes atomically with mode 0600. Prints no configuration values.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

$key = $argv[1] ?? '';
$chat = $argv[2] ?? '';
$title = trim(implode(' ', array_slice($argv, 3)));
if (!preg_match('/^[a-z]{2,16}$/D', $key) || !preg_match('/^-100[0-9]{6,13}$/D', $chat) || $title === '' || mb_strlen($title) > 40) {
    fwrite(STDERR, "Usage: set-extra-group.php <key> <chat_id> <title...>  (key: 2-16 Latin letters; chat_id like -1001234567890)\n");
    exit(1);
}
try {
    $file = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $groups = array_values(array_filter($c['extra_groups'] ?? [], fn($g) => is_array($g) && ($g['key'] ?? null) !== $key));
    $old = array_values(array_filter($c['extra_groups'] ?? [], fn($g) => is_array($g) && ($g['key'] ?? null) === $key))[0] ?? [];
    $entry = ['key' => $key, 'hub_id' => $c['hub_id'] . '-' . $key, 'chat_id' => $chat, 'title' => $title, 'left_label' => 'Покинул чат'];
    if (is_int($old['entrance_thread_id'] ?? null)) $entry['entrance_thread_id'] = $old['entrance_thread_id']; // a re-run keeps the entrance topic
    $groups[] = $entry;
    $c['extra_groups'] = $groups;
    $tmp = tempnam(dirname($file), '.teni-group-');
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
    $found = array_filter($check['extra_groups'] ?? [], fn($g) => ($g['key'] ?? null) === $key && ($g['chat_id'] ?? null) === $chat);
    if (!$found) throw new RuntimeException('Verification failed');
    echo "Extra group set (" . count($check['extra_groups']) . " in total). Other configuration values unchanged.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
