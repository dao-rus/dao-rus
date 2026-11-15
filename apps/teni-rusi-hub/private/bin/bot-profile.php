<?php
declare(strict_types=1);
// Sets the bot's face in Telegram: short description (profile and link previews), description
// (the screen before the first «Начать»), and the command menu. Safe to run again.
// Prints only ok/failed per item; no tokens or configuration values. CLI only.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';

const SHORT = 'Сеть ДАО Русь: находит людей по интересам и делам. Имена — только по согласию обоих.';
const LONG = "Сеть ДАО Русь — коммутатор людей.\n\n" .
    "Напишите, что вас занимает, что нужно или что можете дать, — и бот сведёт вас с теми, кому это близко.\n\n" .
    "• Без имён, пока оба не согласятся на знакомство.\n" .
    "• Без рекламы и рассылок.\n" .
    "• Кодекс: не нападай первым; стой за свою свободу, уважай чужую; власть принадлежит народу.\n\n" .
    "Нажмите «Начать».";
const COMMANDS = [
    ['command' => 'start', 'description' => 'Меню сети'],
    ['command' => 'find', 'description' => 'Найти людей'],
    ['command' => 'who', 'description' => 'Кто здесь'],
    ['command' => 'me', 'description' => 'О себе и настройки'],
];

try {
    $c = \TeniRusi\configuration();
    $bot = new \TeniRusi\Telegram($c['bot_token'] ?? '');
    foreach ([
        'short description' => ['setMyShortDescription', ['short_description' => SHORT]],
        'description' => ['setMyDescription', ['description' => LONG]],
        'commands' => ['setMyCommands', ['commands' => COMMANDS]],
    ] as $label => [$method, $params]) {
        $r = $bot->call($method, $params);
        echo $label . ': ' . (($r['ok'] ?? false) === true ? 'ok' : 'failed (code ' . (int)($r['error_code'] ?? 0) . ')') . "\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, "Stopped: bot profile not set\n");
    exit(1);
}
