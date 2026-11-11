<?php
declare(strict_types=1);
// Expected layout: <account>/www/dao.h1n.ru/webhook.php and <account>/teni-rusi-hub-private/.
// Never place private configuration or source files under the website root.
ini_set('display_errors', '0');
$bootstrap = dirname(__DIR__, 2) . '/teni-rusi-hub-private/src/Bootstrap.php';
if (!is_file($bootstrap)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"ok":false}';
    exit;
}
require $bootstrap;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
ini_set('display_errors', '0');
try {
    $config = \TeniRusi\configuration();
    [$status, $update] = \TeniRusi\Webhook::parse($config, $_SERVER['REQUEST_METHOD'] ?? '',
        $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '',
        file_get_contents('php://input', false, null, 0, 512001) ?: '');
    http_response_code($status);
    if ($update !== null) {
        $hub = new \TeniRusi\Hub(\TeniRusi\database($config), new \TeniRusi\Telegram($config['bot_token']), $config);
        $hub->receive($update);
    }
    echo json_encode(['ok' => $status === 200]);
} catch (\Throwable $e) {
    // Never log the exception: PDO errors can include user IDs; URLs can contain tokens.
    error_log('Teni Rusi webhook failed; inspect database and CLI diagnostics privately.');
    http_response_code(500);
    echo '{"ok":false}'; // Telegram retries; all durable actions are idempotent.
}
