<?php
declare(strict_types=1);
namespace TeniRusi;

final class Webhook
{
    /** Authentication/limits are checked BEFORE any database or Telegram access. */
    public static function parse(array $config, string $method, string $secret, string $body): array
    {
        if (!activationReady($config)) return [503, null];
        if ($method !== 'POST') return [405, null];
        if (!hash_equals($config['webhook_secret'], $secret)) return [401, null];
        if (strlen($body) > 512000) return [413, null];
        try { $u = json_decode($body, true, 32, JSON_THROW_ON_ERROR); }
        catch (\JsonException $e) { return [400, null]; }
        return is_array($u) && is_int($u['update_id'] ?? null) && $u['update_id'] >= 0 ? [200, $u] : [400, null];
    }
}
