// Shared identity preserves instanceof checks in the existing profile/need routes.
export class ProfileAboutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileAboutValidationError";
  }
}

export function normalizeBoundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ProfileAboutValidationError(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized) throw new ProfileAboutValidationError(`${field} must not be empty`);
  if (normalized.length > maxLength) throw new ProfileAboutValidationError(`${field} is too long`);
  return normalized;
}
