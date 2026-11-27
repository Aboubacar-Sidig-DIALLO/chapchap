import { InviteStore } from './invite-store';
import { INVITE_TTL_MS } from './invites.constants';

const now = Date.parse('2026-01-01T12:00:00.000Z');
const friend = { type: 'friend' } as const;
const group = { type: 'group', groupId: 'g1' } as const;

function storeWithTokens() {
  let count = 0;
  return new InviteStore(() => `token-${++count}`);
}

describe('InviteStore (invitations éphémères)', () => {
  it('crée une invitation valable une minute', () => {
    const store = storeWithTokens();
    const invite = store.issue('alice', friend, { now });
    expect(invite).toEqual({
      token: 'token-1',
      creatorId: 'alice',
      target: friend,
      expiresAt: now + INVITE_TTL_MS,
    });
    expect(store.find('token-1', now + INVITE_TTL_MS - 1)).toBe(invite);
  });

  it('disparaît à l’expiration, comme les messages', () => {
    const store = storeWithTokens();
    store.issue('alice', friend, { now });
    expect(store.find('token-1', now + INVITE_TTL_MS)).toBeUndefined();
    // Oubliée pour de bon : une nouvelle demande en crée une autre.
    expect(
      store.issue('alice', friend, { now: now + INVITE_TTL_MS }).token,
    ).toBe('token-2');
  });

  it('réaffiche l’invitation encore valable, une par cible', () => {
    const store = storeWithTokens();
    const first = store.issue('alice', friend, { now });
    expect(store.issue('alice', friend, { now: now + 1000 })).toBe(first);
    // Autre cible, autre auteur : autres invitations.
    expect(store.issue('alice', group, { now }).token).toBe('token-2');
    expect(store.issue('bob', friend, { now }).token).toBe('token-3');
  });

  it('un nouveau lien remplace l’ancien, qui cesse aussitôt de marcher', () => {
    const store = storeWithTokens();
    store.issue('alice', friend, { now });
    const renewed = store.issue('alice', friend, { renew: true, now });
    expect(renewed.token).toBe('token-2');
    expect(store.find('token-1', now)).toBeUndefined();
    expect(store.find('token-2', now)).toBe(renewed);
  });

  it('seul son auteur la désactive', () => {
    const store = storeWithTokens();
    store.issue('alice', friend, { now });
    expect(store.revoke('token-1', 'bob')).toBe(false);
    expect(store.find('token-1', now)).toBeDefined();
    expect(store.revoke('token-1', 'alice')).toBe(true);
    expect(store.find('token-1', now)).toBeUndefined();
  });

  it('génère par défaut des jetons aléatoires de 32 caractères', () => {
    const store = new InviteStore();
    const { token } = store.issue('alice', friend);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(store.issue('alice', friend, { renew: true }).token).not.toBe(token);
  });
});
