/** Rôle du plugin Admin de Better Auth qui ouvre l'administration. */
export const ADMIN_ROLE = 'admin';

/**
 * Compte administrateur. Il se connecte par email et mot de passe ; les
 * autres comptes, par email seul.
 */
export function isAdmin(user: object | null | undefined): boolean {
  // Champ ajouté par le plugin Admin, absent des types de base de Better Auth.
  return (user as { role?: unknown } | null | undefined)?.role === ADMIN_ROLE;
}
