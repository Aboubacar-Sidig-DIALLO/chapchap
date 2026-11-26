/** Limites — à garder synchronisées avec le front (`chat-nextjs/src/features/social/lib/config.ts`). */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 50;
export const SEARCH_MAX_RESULTS = 20;

export const GROUP_NAME_MAX_LENGTH = 40;
/** Créateur compris. */
export const GROUP_MAX_MEMBERS = 50;
/** Taille maximale d'une photo de groupe (le client la réduit avant l'envoi). */
export const GROUP_PHOTO_MAX_SIZE = 2 * 1024 * 1024; // 2 Mo

/** Champs publics d'un utilisateur, à utiliser dans tous les `select` Prisma. */
export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  image: true,
} as const;
