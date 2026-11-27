/**
 * Un lien d'invité non utilisé cesse de fonctionner au bout de ce délai (et,
 * de toute façon, dès la fin de l'appel). À garder synchronisé avec le front
 * (`chat-nextjs/src/features/call-guests/lib/config.ts`).
 */
export const GUEST_LINK_TTL_MS = 15 * 60 * 1000;

/** Invités présents ou attendus au plus par appel : l'appel reste celui du groupe. */
export const MAX_GUESTS_PER_CALL = 3;

/** Longueur maximale du nom choisi par l'invité. */
export const GUEST_NAME_MAX_LENGTH = 40;

/** Aléa des jetons (lien et laissez-passer) : 192 bits, 32 caractères en base64url. */
export const GUEST_TOKEN_BYTES = 24;
export const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Espace Socket.io des invités, isolé de celui du chat. */
export const GUEST_NAMESPACE = '/call-guests';
