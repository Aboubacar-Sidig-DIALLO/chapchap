/** Longueur maximale d'un nom ou pseudo — à garder synchronisée avec le front (`chat-nextjs/src/features/auth/lib/validation.ts`). */
export const MAX_NAME_LENGTH = 32;

/** Une session reste ouverte 30 jours, prolongée au plus une fois par jour. */
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/** Tentatives d'inscription / connexion autorisées par adresse IP et par minute. */
export const AUTH_RATE_LIMIT_PER_MINUTE = 5;

/** Codes d'erreur métier renvoyés au front, qui les traduit. */
export const AUTH_ERROR = {
  NAME_REQUIRED: 'NAME_REQUIRED',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  INVALID_EMAIL: 'INVALID_EMAIL',
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  EMAIL_UNCHANGED: 'EMAIL_UNCHANGED',
  /** Suppression : l'adresse tapée pour confirmer n'est pas celle du compte. */
  EMAIL_MISMATCH: 'EMAIL_MISMATCH',
} as const;
