/**
 * Durée de vie d'une invitation : une minute, puis elle disparaît, comme
 * les messages. À garder synchronisée avec le front
 * (`chat-nextjs/src/features/invites/lib/config.ts`).
 */
export const INVITE_TTL_MS = 60 * 1000;

/**
 * Aléa du jeton (192 bits) : impossible à deviner, même en essayant en
 * masse ; 32 caractères une fois encodé en base64url.
 */
export const INVITE_TOKEN_BYTES = 24;

/** Forme d'un jeton (base64url, 32 caractères). */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
