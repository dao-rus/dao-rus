<?php
declare(strict_types=1);
namespace TeniRusi;

/**
 * The hub collects calls from the relay (relay/worker.js on Cloudflare) instead of waiting for them:
 * the hosting does not let data-center traffic in, but our own outgoing requests pass. One run lasts
 * under a minute (cron every minute under flock): pull → answer → pull with the answers → …
 */
final class Relay
{
    public const RUN_SECONDS = 40;   // + up to 20 s of the last waiting pull

    public function __construct(private Api $api, private Mcp $mcp, private string $url, private string $secret) {}

    /** One call from the relay → the reply it will hand back to the caller. */
    public function dispatch(array $r): array
    {
        $id = is_string($r['id'] ?? null) ? $r['id'] : '';
        $path = is_string($r['path'] ?? null) ? $r['path'] : '';
        $method = is_string($r['method'] ?? null) ? $r['method'] : '';
        $headers = is_array($r['headers'] ?? null) ? $r['headers'] : [];
        $body = is_string($r['body'] ?? null) ? $r['body'] : '';
        $auth = is_string($headers['authorization'] ?? null) ? $headers['authorization'] : '';
        try {
            if (preg_match('#^/api/?$#D', $path)) {
                [$status, $out] = $this->api->handle($method, $auth, $body);
                return ['id' => $id, 'status' => $status, 'type' => 'application/json; charset=utf-8', 'body' => json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
            }
            if (preg_match('#^/mcp(?:/([A-Za-z0-9_-]{1,64}))?$#D', $path, $m)) {
                [$status, $type, $out] = $this->mcp->handle($method, $auth, $m[1] ?? '', $body);
                return ['id' => $id, 'status' => $status, 'type' => $type, 'body' => $out] + ($status === 405 ? ['headers' => ['allow' => 'POST']] : []);
            }
            return ['id' => $id, 'status' => 404, 'type' => 'application/json', 'body' => '{"ok":false,"error":"not_found"}'];
        } catch (\Throwable $e) {
            error_log('Relay dispatch failed: ' . get_class($e)); // never the message: it may hold user data
            return ['id' => $id, 'status' => 500, 'type' => 'application/json', 'body' => '{"ok":false}'];
        }
    }

    /** Runs until the deadline; returns the number of calls answered. */
    public function run(callable $post, int $seconds = self::RUN_SECONDS): int
    {
        $deadline = time() + $seconds;
        $replies = [];
        $served = 0;
        $errors = 0;
        while (true) {
            $last = time() >= $deadline;
            $res = $post($this->url . '/_pull' . ($last ? '?wait=0' : ''), $this->secret, ['replies' => $replies]);
            $replies = [];
            if (!is_array($res) || ($res['ok'] ?? false) !== true) {
                if (++$errors >= 3 || $last) break;
                sleep(5);
                continue;
            }
            $errors = 0;
            foreach ($res['requests'] ?? [] as $r) if (is_array($r)) { $replies[] = $this->dispatch($r); $served++; }
            if ($last && !$replies) break;
        }
        return $served;
    }

    /** HTTP POST of JSON with the shared secret; null on any failure. */
    public static function post(string $url, string $secret, array $data): ?array
    {
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $secret],
            CURLOPT_POSTFIELDS => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2]);
        $body = curl_exec($curl);
        $code = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if (!is_string($body) || $code !== 200) return null;
        $out = json_decode($body, true);
        return is_array($out) ? $out : null;
    }
}
