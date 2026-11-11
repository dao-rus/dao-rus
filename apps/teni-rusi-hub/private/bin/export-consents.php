<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
try {
    $db = \TeniRusi\database(\TeniRusi\configuration());
    $query = $db->query('SELECT c.*,r.status AS telegram_status FROM trh_consents c JOIN trh_requests r ON r.id=c.request_id ORDER BY c.accepted_at,c.request_id');
    while ($row = $query->fetch()) echo json_encode(['source' => 'teni-rusi-hub', 'schema_version' => 1,
        'event_id' => $row['request_id'], 'hub_id' => $row['hub_id'], 'telegram_user_id' => $row['telegram_user_id'],
        'code_version' => $row['code_version'], 'accepted_at' => gmdate('c', (int)$row['accepted_at']),
        'telegram_status' => $row['telegram_status']], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
} catch (\Throwable $e) { fwrite(STDERR, "Export failed; partial output must not be imported.\n"); exit(1); }
