import { accountEvents, type DeletedAccount } from './account-events';
import { findAccountLinks } from './account-links';
import { userDeleteHooks } from './user-delete-hooks';

jest.mock('./account-links', () => ({ findAccountLinks: jest.fn() }));

describe('userDeleteHooks', () => {
  it('prévient les proches et ferme les connexions du compte supprimé', async () => {
    jest.mocked(findAccountLinks).mockResolvedValue({
      relatedUserIds: ['bob'],
      groupIds: ['g1'],
    });
    const signedOut: string[] = [];
    const deleted: DeletedAccount[] = [];
    const subscriptions = [
      accountEvents.signedOutEverywhere$.subscribe(({ userId }) =>
        signedOut.push(userId),
      ),
      accountEvents.deleted$.subscribe((account) => deleted.push(account)),
    ];

    // Liens lus avant la suppression (qui les efface en cascade)…
    await userDeleteHooks.before({ id: 'ana' });
    // …et annoncés une fois le compte supprimé.
    await userDeleteHooks.after({ id: 'ana' });

    expect(signedOut).toEqual(['ana']);
    expect(deleted).toEqual([
      { userId: 'ana', relatedUserIds: ['bob'], groupIds: ['g1'] },
    ]);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
  });
});
