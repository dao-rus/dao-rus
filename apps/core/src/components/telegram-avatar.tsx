type TelegramAvatarProps = {
  participantId: string;
  displayName: string;
  avatarUrl: string | null;
  hasTelegramPhoto: boolean;
};

export function TelegramAvatar({ participantId, displayName, avatarUrl, hasTelegramPhoto }: TelegramAvatarProps) {
  const src = hasTelegramPhoto
    ? `/api/telegram/profile-photo/${participantId}`
    : avatarUrl;
  return src ? (
    <img className="telegramAvatar" src={src} alt={`Фото ${displayName}`} referrerPolicy="no-referrer" loading="lazy" />
  ) : null;
}
