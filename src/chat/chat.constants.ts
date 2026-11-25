/** Réactions proposées sur un message — à garder synchronisé avec le client (`lib/config.ts`). */
export const REACTION_EMOJIS = ['❤️', '😂', '🔥', '👏', '😮', '🙏'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return REACTION_EMOJIS.includes(value as ReactionEmoji);
}

/**
 * Durée de vie d'un message et de ses pièces jointes : application de
 * l'instant, rien n'est conservé au-delà (ni en mémoire, ni sur disque, ni en
 * base). À garder synchronisé avec le client (`features/chat/lib/config.ts`).
 */
export const MESSAGE_TTL_MS = 60 * 60 * 1000;

/** Fréquence du ménage des messages et fichiers expirés. */
export const CLEANUP_INTERVAL_MS = 60 * 1000;
