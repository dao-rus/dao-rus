<?php
declare(strict_types=1);
// Sets the relay address and its shared secret in the private config.php.
// Usage: set-relay.php https://hub.SUBDOMAIN.workers.dev < file-with-secret
// The secret is read from standard input (32–128 letters/digits) so that it never appears in the
// command line or the output. Writes atomically with mode 0600. Prints no configuration values.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

$url = $argv[1] ?? '';
$secret = trim((string)stream_get_contents(STDIN));
if (!preg_match('#^https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$#D', $url) || !preg_match('/^[A-Za-z0-9]{32,128}$/D', $secret)) {
    fwrite(STDERR, "Usage: set-relay.php https://NAME.SUBDOMAIN.workers.dev < secret-file  (secret: 32-128 letters/digits)\n");
    exit(1);
}
try {
    $file = dirname(__DIR__) . '/config.php';
    $c = \TeniRusi\configuration();
    $c['relay_url'] = $url;
    $c['relay_secret'] = $secret;
    $tmp = tempnam(dirname($file), '.teni-relay-');
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
    if (($check['relay_url'] ?? null) !== $url || ($check['relay_secret'] ?? null) !== $secret) throw new RuntimeException('Verification failed');
    echo "Relay set. Other configuration values unchanged.\n";
} catch (Throwable $e) {
    fwrite(STDERR, "Stopped: relay not set\n");
    exit(1);
}
