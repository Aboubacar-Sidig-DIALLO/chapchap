import { accountEvents } from './account-events';
import { findAccountLinks } from './account-links';

type AccountLinks = Awaited<ReturnType<typeof findAccountLinks>>;

/**
 * Liens des comptes en cours de suppression, lus juste avant (la suppression
 * les efface en cascade), pour prévenir ensuite les personnes concernées.
 */
const pendingDeletions = new Map<string, AccountLinks>();

/**
 * Suppression d'un compte, quelle qu'en soit l'origine (l'utilisateur
 * lui-même, ou un administrateur) : ses connexions temps réel se ferment, ses
 * amis et ses groupes sont prévenus.
 */
export const userDeleteHooks = {
  async before(user: { id: string }) {
    pendingDeletions.set(user.id, await findAccountLinks(user.id));
  },
  after(user: { id: string }) {
    const links = pendingDeletions.get(user.id) ?? {
      relatedUserIds: [],
      groupIds: [],
    };
    pendingDeletions.delete(user.id);
    accountEvents.signedOutEverywhere$.next({ userId: user.id });
    accountEvents.deleted$.next({ userId: user.id, ...links });
    return Promise.resolve();
  },
};
