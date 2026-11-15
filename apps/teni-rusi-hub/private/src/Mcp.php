<?php
declare(strict_types=1);
namespace TeniRusi;

/**
 * Step 3 of the switchboard protocol: an MCP server (Streamable HTTP, stateless, JSON answers) so that a
 * person can use the network from their own AI assistant (Claude, ChatGPT). Address: …/mcp/KEY, where KEY is
 * the person's key from /key in the bot (or «Authorization: Bearer KEY»). Every tool is a call of the API
 * (Api.php) on behalf of that person: same actions, rules, limits and consent as in the bot.
 */
final class Mcp
{
    public const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

    private const INSTRUCTIONS = 'Коммутатор сети ДАО Русь помогает человеку найти людей по интересам, делам и нуждам и познакомиться с ними. ' .
        'Записи показываются без имён; имя и контакт открываются, только когда согласны обе стороны. ' .
        'Показывай пользователю ответы коммутатора своими словами, ничего не выдумывай, и предлагай следующие шаги из списка «Возможные действия» (инструмент do_action). ' .
        'Просьбы о знакомстве, ответы на них и похожие записи приходят человеку в Telegram-бот @Daorus_bot. ' .
        'Прежде чем оставить запись или попросить о знакомстве от имени пользователя, убедись, что он этого хочет.';

    public function __construct(private Api $api) {}

    /** @return array{0:int,1:string,2:string} HTTP status, content type, body */
    public function handle(string $method, string $auth, string $pathKey, string $body): array
    {
        if ($method !== 'POST') return [405, 'application/json; charset=utf-8', '{"error":"POST only"}'];
        try { $m = json_decode($body, true, 16, JSON_THROW_ON_ERROR); }
        catch (\JsonException $e) { return self::out(self::error(null, -32700, 'Parse error')); }
        if (!is_array($m) || array_is_list($m)) return self::out(self::error(null, -32600, 'Batches are not supported'));
        $id = $m['id'] ?? null;
        $name = $m['method'] ?? null;
        if (!is_string($name)) return self::out(self::error($id, -32600, 'Invalid request'));
        if (!array_key_exists('id', $m)) return [202, '', ''];   // notification (notifications/initialized etc.)
        $key = $pathKey !== '' ? $pathKey : (preg_match('/^Bearer\s+(\S+)$/i', trim($auth), $k) ? $k[1] : '');
        return self::out(match ($name) {
            'initialize' => self::result($id, [
                'protocolVersion' => in_array($m['params']['protocolVersion'] ?? null, self::VERSIONS, true) ? $m['params']['protocolVersion'] : self::VERSIONS[0],
                'capabilities' => ['tools' => ['listChanged' => false]],
                'serverInfo' => ['name' => 'kommutator', 'title' => 'Коммутатор ДАО Русь', 'version' => Api::VERSION],
                'instructions' => self::INSTRUCTIONS,
            ]),
            'ping' => self::result($id, new \stdClass()),
            'tools/list' => self::result($id, ['tools' => self::tools()]),
            'tools/call' => $this->call($id, $key, $m['params'] ?? []),
            default => self::error($id, -32601, 'Method not found'),
        });
    }

    private function call($id, string $key, $params): array
    {
        $tool = is_array($params) ? ($params['name'] ?? null) : null;
        $args = is_array($params['arguments'] ?? null) ? $params['arguments'] : [];
        $str = fn(string $k): ?string => is_string($args[$k] ?? null) && trim($args[$k]) !== '' ? trim($args[$k]) : null;
        [$action, $text] = match ($tool) {
            'menu' => ['menu', null],
            'find_people' => ['find', $str('query')],
            'add_record' => [in_array($args['kind'] ?? null, ['need', 'have', 'do', 'interest'], true) ? 'new:' . $args['kind'] : null, $str('text')],
            'who_is_here' => ['who', null],
            'latest_records' => ['list', null],
            'my_records' => ['mine', null],
            'about_me' => ['me', null],
            'do_action' => [$str('action'), $str('text')],
            default => [false, null],
        };
        if ($action === false) return self::error($id, -32602, 'Unknown tool');
        if ($action === null || (in_array($tool, ['find_people', 'add_record'], true) && $text === null)) return self::toolText($id, 'Не хватает параметров: ' . ($tool === 'find_people' ? 'query' : ($tool === 'add_record' ? 'kind и text' : 'action')) . '.', true);
        if ($key === '') return self::toolText($id, 'Нет ключа. Человек получает его командой /key в Telegram-боте @Daorus_bot; адрес подключения — …/mcp/КЛЮЧ.', true);
        [$status, $out] = $this->api->handle('POST', 'Bearer ' . $key, json_encode(['action' => $action, 'text' => $text], JSON_UNESCAPED_UNICODE));
        if ($status !== 200) return self::toolText($id, match ($out['error'] ?? '') {
            'key' => $out['hint'] ?? 'Ключ не принят.',
            'daily_limit' => 'На сегодня запросов достаточно, продолжим завтра.',
            default => 'Коммутатор не смог выполнить запрос (' . ($out['error'] ?? $status) . ').',
        }, true);
        return self::toolText($id, self::render($out), in_array($out['result'] ?? '', ['unknown_action', 'net_denied'], true));
    }

    /** The bot's answer as text for the assistant, with the next actions and contacts. */
    public static function render(array $out): string
    {
        $parts = [];
        foreach ($out['messages'] ?? [] as $msg) {
            $p = trim((string)($msg['text'] ?? ''));
            foreach ($msg['contacts'] ?? [] as $c) $p .= "\nКонтакт: " . $c['name'] . ' — ' . $c['telegram'];
            if (!empty($msg['actions'])) {
                $p .= "\nВозможные действия:";
                foreach ($msg['actions'] as $a) $p .= "\n- «" . $a['label'] . '» → do_action(action="' . $a['action'] . '")';
            }
            if ($p !== '') $parts[] = $p;
        }
        return ($parts ? implode("\n\n", $parts) : 'Готово.') . "\n\n[результат: " . ($out['result'] ?? '?') . ']';
    }

    public static function tools(): array
    {
        $o = fn(array $props = [], array $req = []) => ['type' => 'object', 'properties' => $props ?: new \stdClass()] + ($req ? ['required' => $req] : []);
        $s = fn(string $d) => ['type' => 'string', 'description' => $d];
        $ro = ['readOnlyHint' => true];
        return [
            ['name' => 'find_people', 'title' => 'Найти людей', 'description' => 'Ищет в сети записи людей по словам (интересы, дела, нужды, город). Имена не показываются; у результатов есть действие «Познакомиться».',
                'inputSchema' => $o(['query' => $s('Несколько слов: кого или что ищем, например «децентрализованные организации Москва»')], ['query'])],
            ['name' => 'add_record', 'title' => 'Оставить запись', 'description' => 'Оставляет запись от имени пользователя: need — «Нужно», have — «Есть, могу дать», do — «Хочу сделать», interest — «Интерес». По записи пользователя найдут другие. Сразу показывает похожие записи.',
                'inputSchema' => $o(['kind' => ['type' => 'string', 'enum' => ['need', 'have', 'do', 'interest']], 'text' => $s('Сама запись одним сообщением, до 500 символов')], ['kind', 'text'])],
            ['name' => 'who_is_here', 'title' => 'Кто здесь', 'description' => 'Сводка по сети без имён: сколько людей, о чём чаще пишут, города (только группы от 3 человек).', 'inputSchema' => $o(), 'annotations' => $ro],
            ['name' => 'latest_records', 'title' => 'Свежие записи', 'description' => 'Свежие открытые записи сети без имён.', 'inputSchema' => $o(), 'annotations' => $ro],
            ['name' => 'my_records', 'title' => 'Мои записи', 'description' => 'Записи пользователя: срок, видимость; действия снять, скрыть, продлить.', 'inputSchema' => $o(), 'annotations' => $ro],
            ['name' => 'about_me', 'title' => 'О себе', 'description' => 'Уровень доверия пользователя, отзывы без имён авторов, строка о себе, настройки.', 'inputSchema' => $o(), 'annotations' => $ro],
            ['name' => 'menu', 'title' => 'Меню и правила', 'description' => 'Что умеет сеть и её правила (Кодекс).', 'inputSchema' => $o(), 'annotations' => $ro],
            ['name' => 'do_action', 'title' => 'Действие', 'description' => 'Выполняет одно из «Возможных действий», которые коммутатор перечислил в прошлом ответе (например req:…, ok:…, no:…, del:…, city:…). Для city:… и about нужен text.',
                'inputSchema' => $o(['action' => $s('Действие ровно как в списке «Возможные действия»'), 'text' => $s('Текст, если действие его ждёт (город, строка о себе)')], ['action'])],
        ];
    }

    private static function result($id, $result): array { return ['jsonrpc' => '2.0', 'id' => $id, 'result' => $result]; }
    private static function error($id, int $code, string $message): array { return ['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => $code, 'message' => $message]]; }
    private static function toolText($id, string $text, bool $isError): array
    {
        return self::result($id, ['content' => [['type' => 'text', 'text' => $text]], 'isError' => $isError]);
    }
    private static function out(array $msg): array
    {
        return [200, 'application/json; charset=utf-8', json_encode($msg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
    }
}
