<?php
declare(strict_types=1);
// Collects calls of programs and AI assistants from the relay (relay/worker.js) and answers them.
// Cron every minute under flock, e.g.:
//   * * * * * flock -n PRIVATE/relay.lock /usr/bin/php82 PRIVATE/bin/relay-pull.php 2>>PRIVATE/relay-errors.log
// Idles when the relay is not configured (bin/set-relay.php). Prints nothing on success; never prints
// secrets, keys, user IDs or texts.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
try {
    $c = \TeniRusi\configuration();
    if (empty($c['relay_url']) || empty($c['relay_secret']) || !\TeniRusi\activationReady($c)) exit(0);
    $api = new \TeniRusi\Api(\TeniRusi\database($c), new \TeniRusi\Telegram($c['bot_token']), $c);
    $relay = new \TeniRusi\Relay($api, new \TeniRusi\Mcp($api), rtrim($c['relay_url'], '/'), $c['relay_secret']);
    $relay->run([\TeniRusi\Relay::class, 'post']);
    @file_put_contents(dirname(__DIR__) . '/relay-heartbeat', (string)time());
} catch (\Throwable $e) {
    fwrite(STDERR, gmdate('c') . ' relay run failed: ' . get_class($e) . "\n");
    exit(1);
}
