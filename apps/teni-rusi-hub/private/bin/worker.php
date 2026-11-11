<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
try {
    $c = \TeniRusi\configuration();
    if (!\TeniRusi\activationReady($c)) { fwrite(STDERR, "Hub is disabled or activation is incomplete.\n"); exit(1); }
    (new \TeniRusi\Hub(\TeniRusi\database($c), new \TeniRusi\Telegram($c['bot_token']), $c))->tick();
    echo "Batch completed.\n";
} catch (\Throwable $e) { fwrite(STDERR, "Worker failed. Check private configuration/database; no secrets logged.\n"); exit(1); }
