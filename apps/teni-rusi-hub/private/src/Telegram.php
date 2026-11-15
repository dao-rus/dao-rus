<?php
declare(strict_types=1);
namespace TeniRusi;

interface Bot
{
    /** Returns parsed Bot API response. Missing/ambiguous response: error_code=0. */
    public function call(string $method, array $params): array;
}

final class Telegram implements Bot
{
    public function __construct(private string $token)
    {
        if (!preg_match('/^[1-9][0-9]*:[A-Za-z0-9_-]+$/D', $token)) throw new \InvalidArgumentException('Invalid bot token format');
    }

    public function call(string $method, array $params): array
    {
        // This adapter exposes no setWebhook, token URLs, raw errors or message logs.
        if (!in_array($method, ['sendMessage', 'forwardMessage', 'copyMessage', 'editMessageText', 'answerCallbackQuery', 'approveChatJoinRequest',
            'declineChatJoinRequest', 'getChatMember', 'getChat', 'getMe', 'getWebhookInfo',
            'setMyShortDescription', 'setMyDescription', 'setMyCommands'], true)) {
            throw new \InvalidArgumentException('Unsupported Telegram method');
        }
        $curl = curl_init('https://api.telegram.org/bot' . $this->token . '/' . $method);
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($params, JSON_THROW_ON_ERROR),
            CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_TIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2]);
        $body = curl_exec($curl);
        curl_close($curl);
        if (!is_string($body)) return ['ok' => false, 'error_code' => 0];
        try {
            $result = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
            return is_array($result) && is_bool($result['ok'] ?? null)
                ? $result : ['ok' => false, 'error_code' => 0];
        } catch (\JsonException $e) {
            return ['ok' => false, 'error_code' => 0];
        }
    }
}
