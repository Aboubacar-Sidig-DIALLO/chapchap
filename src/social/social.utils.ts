import type { PublicUser } from './social.types';

/** Version publique d'un utilisateur (ex. celui de la session) : jamais son email. */
export function toPublicUser(user: {
  id: string;
  name: string;
  image?: string | null;
}): PublicUser {
  return { id: user.id, name: user.name, image: user.image ?? null };
}

/**
 * Salle Socket.io personnelle : toutes les connexions d'un utilisateur (onglets,
 * appareils), pour lui parler où qu'il soit.
 */
export function userRoom(userId: string) {
  return `user:${userId}`;
}

/** Une paire est toujours rangée dans le même ordre : un seul lien possible par paire. */
export function pairOf(userId: string, otherId: string) {
  return userId < otherId
    ? { userAId: userId, userBId: otherId }
    : { userAId: otherId, userBId: userId };
}
