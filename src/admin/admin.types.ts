/** Contrat de l'API d'administration — à garder synchronisé avec le front (`chat-nextjs/src/features/admin/types.ts`). */

/** Vue d'ensemble des comptes, en tête de l'administration. */
export interface AdminStats {
  /** Comptes existants. */
  users: number;
  /** Comptes ayant l'application ouverte en ce moment. */
  online: number;
  /** Comptes de rôle `admin`. */
  admins: number;
  /** Comptes suspendus (suspension en cours). */
  banned: number;
  /** Comptes créés ces 7 derniers jours. */
  newThisWeek: number;
}

/** Un compte, tel que le voit un administrateur. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: 'admin' | 'user';
  /** Suspension en cours (une suspension échue ne compte plus). */
  banned: boolean;
  banReason: string | null;
  /** Fin de la suspension (ISO 8601) ; `null` : définitive. */
  banExpires: string | null;
  online: boolean;
  /** Dates ISO 8601. */
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminUserPage {
  users: AdminUser[];
  /** Comptes correspondant à la recherche et au filtre. */
  total: number;
  page: number;
  pageSize: number;
}
