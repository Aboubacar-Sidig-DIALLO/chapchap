/** Réactions proposées sur un message — à garder synchronisé avec le client (`lib/config.ts`). */
export const REACTION_EMOJIS = ['❤️', '😂', '🔥', '👏', '😮', '🙏'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return REACTION_EMOJIS.includes(value as ReactionEmoji);
}
