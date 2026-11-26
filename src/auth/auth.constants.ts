/** Longueur maximale d'un nom ou pseudo — à garder synchronisée avec le front (`chat-nextjs/src/features/auth/lib/validation.ts`). */
export const MAX_NAME_LENGTH = 32;

/** Une session reste ouverte 30 jours, prolongée au plus une fois par jour. */
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/** Tentatives d'inscription / connexion autorisées par adresse IP et par minute. */
export const AUTH_RATE_LIMIT_PER_MINUTE = 5;

/**
 * Mots de passe, réservés aux administrateurs — à garder synchronisés avec le
 * front (`chat-nextjs/src/features/auth/lib/password.ts`).
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Une session « en tant que » ouverte par un administrateur dure 30 minutes. */
export const IMPERSONATION_SESSION_SECONDS = 30 * 60;

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
  /** Administration : un administrateur ne change pas son propre rôle. */
  CANNOT_CHANGE_OWN_ROLE: 'CANNOT_CHANGE_OWN_ROLE',
  /** Connexion par email seul d'un administrateur : son mot de passe est requis. */
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  /** Administration : un administrateur doit avoir un mot de passe. */
  ADMIN_PASSWORD_REQUIRED: 'ADMIN_PASSWORD_REQUIRED',
  /** Administration : le mot de passe est réservé aux administrateurs. */
  PASSWORD_ADMIN_ONLY: 'PASSWORD_ADMIN_ONLY',
  /** Même code que Better Auth : adresse inconnue ou mot de passe faux, sans distinction. */
  INVALID_EMAIL_OR_PASSWORD: 'INVALID_EMAIL_OR_PASSWORD',
} as const;
