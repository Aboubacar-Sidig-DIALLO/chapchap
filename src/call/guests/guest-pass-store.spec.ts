import {
  GUEST_LINK_TTL_MS,
  MAX_GUESTS_PER_CALL,
} from './call-guests.constants';
import { GuestPassStore } from './guest-pass-store';

const now = Date.parse('2026-01-01T12:00:00.000Z');
const call = {
  conversationKey: 'group:g1',
  groupId: 'g1',
  inviterId: 'alice',
  inviterName: 'Alice',
};

function storeWithTokens() {
  let count = 0;
  return new GuestPassStore(() => `token-${++count}`);
}

describe('GuestPassStore (invités d’un appel de groupe)', () => {
  it('le lien ne sert qu’une fois : il devient un laissez-passer', () => {
    const store = storeWithTokens();
    const link = store.createLink(call, now);
    expect(link?.token).toBe('token-1');

    const pass = store.claim('token-1', 'Paul', now);
    expect(pass).toMatchObject({
      pass: 'token-2',
      conversationKey: 'group:g1',
      guest: { name: 'Paul', isGuest: true },
    });
    expect(pass?.guest.id).toMatch(/^guest:/);
    expect(store.findPass('token-2')).toBe(pass);

    // Déjà utilisé : plus personne ne peut s'en servir.
    expect(store.findLink('token-1', now)).toBeUndefined();
    expect(store.claim('token-1', 'Intrus', now)).toBeNull();
  });

  it('un lien inutilisé expire', () => {
    const store = storeWithTokens();
    store.createLink(call, now);
    expect(store.claim('token-1', 'Paul', now + GUEST_LINK_TTL_MS)).toBeNull();
  });

  it('limite les invités d’un appel, liens en attente compris', () => {
    const store = storeWithTokens();
    for (let index = 0; index < MAX_GUESTS_PER_CALL; index++) {
      expect(store.createLink(call, now)).not.toBeNull();
    }
    expect(store.createLink(call, now)).toBeNull();
    // Un autre appel n'est pas concerné.
    expect(
      store.createLink({ ...call, conversationKey: 'group:g2' }, now),
    ).not.toBeNull();
  });

  it('la fin de l’appel efface liens et laissez-passer', () => {
    const store = storeWithTokens();
    store.createLink(call, now);
    store.createLink(call, now);
    const pass = store.claim('token-1', 'Paul', now);
    store.revokeConversation('group:g1');
    expect(store.findPass(pass!.pass)).toBeUndefined();
    expect(store.findLink('token-2', now)).toBeUndefined();
  });

  it('un invité retiré ne peut plus revenir', () => {
    const store = storeWithTokens();
    store.createLink(call, now);
    const pass = store.claim('token-1', 'Paul', now)!;
    store.revokeGuest(pass.guest.id);
    expect(store.findPass(pass.pass)).toBeUndefined();
  });

  it('seul son auteur retire un lien inutilisé', () => {
    const store = storeWithTokens();
    store.createLink(call, now);
    expect(store.revokeLink('token-1', 'bob')).toBe(false);
    expect(store.revokeLink('token-1', 'alice')).toBe(true);
    expect(store.findLink('token-1', now)).toBeUndefined();
  });

  it('génère par défaut des jetons aléatoires de 32 caractères', () => {
    const link = new GuestPassStore().createLink(call);
    expect(link?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
