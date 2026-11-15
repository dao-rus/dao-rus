<?php
declare(strict_types=1);
// Switchboard API for programs and AI assistants (protocol step 2). Same layout as webhook.php:
// <account>/www/dao.h1n.ru/api.php and <account>/teni-rusi-hub-private/.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
$bootstrap = dirname(__DIR__, 2) . '/teni-rusi-hub-private/src/Bootstrap.php';
if (!is_file($bootstrap)) { http_response_code(503); echo '{"ok":false}'; exit; }
require $bootstrap;
try {
    $config = \TeniRusi\configuration();
    if (!\TeniRusi\activationReady($config)) { http_response_code(503); echo '{"ok":false}'; exit; }
    // Some hostings drop the Authorization header for PHP; the key may also come as "key" in the JSON body.
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    $api = new \TeniRusi\Api($method === 'POST' ? \TeniRusi\database($config) : null, new \TeniRusi\Telegram($config['bot_token']), $config);
    [$status, $out] = $api->handle($method, $auth, file_get_contents('php://input', false, null, 0, 16385) ?: '');
    http_response_code($status);
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (\Throwable $e) {
    // Never log the exception: PDO errors can include user IDs; URLs can contain tokens.
    error_log('Teni Rusi API failed; inspect database and CLI diagnostics privately.');
    http_response_code(500);
    echo '{"ok":false}';
}
