import { Subject } from 'rxjs';

/** Compte supprimé, avec ceux qui le connaissaient (lus avant la suppression). */
export interface DeletedAccount {
  userId: string;
  /** Amis et demandes en cours, dans les deux sens. */
  relatedUserIds: string[];
  /** Groupes dont il faisait partie. */
  groupIds: string[];
}

/**
 * Événements du cycle de vie des comptes. Better Auth les émet (il vit hors de
 * l'injection de dépendances de Nest) ; le temps réel les écoute pour fermer
 * les connexions et prévenir les autres utilisateurs.
 */
export const accountEvents = {
  /** Nom ou adresse modifiés : les listes de ses amis sont à rafraîchir. */
  updated$: new Subject<{ userId: string }>(),
  /** Toutes ses sessions ont été supprimées : ses connexions temps réel doivent se fermer. */
  signedOutEverywhere$: new Subject<{ userId: string }>(),
  deleted$: new Subject<DeletedAccount>(),
};
