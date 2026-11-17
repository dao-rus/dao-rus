<?php
declare(strict_types=1);
// Tells the bot which topic (thread) of the DAO chat is «Приёмная»: stories of newcomers are posted there.
// Usage: set-entrance-thread.php <thread_id>   (the number after the chat number in a topic link:
//   t.me/c/<chat>/<thread>/<message>). Needs the extra group «dao» (set-extra-group.php) first.
// Writes atomically with mode 0600. Prints no configuration values.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

$thread = $argv[1] ?? '';
if (!preg_match('/^[1-9][0-9]{0,9}$/D', $thread)) {
    fwrite(STDERR, "Usage: set-entrance-thread.php <thread_id>  (a positive number)\n");
    exit(1);
}
try {
    $file = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $done = false;
    foreach ($c['extra_groups'] ?? [] as $i => $g) {
        if (is_array($g) && ($g['key'] ?? null) === 'dao') { $c['extra_groups'][$i]['entrance_thread_id'] = (int)$thread; $done = true; }
    }
    if (!$done) throw new RuntimeException('No group «dao»: run set-extra-group.php first');
    $tmp = tempnam(dirname($file), '.teni-thread-');
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
    $ok = array_filter($check['extra_groups'] ?? [], fn($g) => ($g['key'] ?? null) === 'dao' && ($g['entrance_thread_id'] ?? null) === (int)$thread);
    if (!$ok) throw new RuntimeException('Verification failed');
    echo "Entrance topic set. Other configuration values unchanged.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
