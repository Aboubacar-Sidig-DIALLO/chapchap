import {
  actionsOfMessage,
  ALL_ALLOWED,
  restrictionError,
  rightsOf,
  roleOf,
} from './group-rights';

describe('group rights', () => {
  describe('roleOf', () => {
    it("désigne le propriétaire d'après le groupe, quel que soit son rôle enregistré", () => {
      expect(roleOf('ana', { userId: 'ana', role: 'MEMBER' })).toBe('owner');
      expect(roleOf('ana', { userId: 'bob', role: 'ADMIN' })).toBe('admin');
      expect(roleOf('ana', { userId: 'eve', role: 'MEMBER' })).toBe('member');
    });
  });

  describe('rightsOf', () => {
    const closed = { write: false, voice: false, call: false };

    it('ne restreint jamais le propriétaire ni un administrateur, qui modèrent', () => {
      for (const role of ['owner', 'admin'] as const) {
        expect(rightsOf(role, closed, closed)).toEqual({
          moderate: true,
          restrictions: { write: null, voice: null, call: null },
        });
      }
    });

    it("restreint un membre par le groupe d'abord, puis à titre personnel", () => {
      const rights = rightsOf(
        'member',
        { write: false, voice: true, call: true },
        { write: false, voice: false, call: true },
      );
      expect(rights).toEqual({
        moderate: false,
        restrictions: { write: 'group', voice: 'personal', call: null },
      });
    });

    it('laisse tout faire à un membre sans restriction, sauf modérer', () => {
      expect(rightsOf('member', ALL_ALLOWED, ALL_ALLOWED).moderate).toBe(false);
    });
  });

  describe('actionsOfMessage', () => {
    it('distingue un vocal de ce qui s’écrit (texte, fichiers)', () => {
      expect(actionsOfMessage('', [{ voice: {} }])).toEqual(['voice']);
      expect(actionsOfMessage('salut', [])).toEqual(['write']);
      expect(actionsOfMessage('', [{}])).toEqual(['write']);
      expect(actionsOfMessage('regarde', [{ voice: {} }, {}])).toEqual([
        'write',
        'voice',
      ]);
    });
  });

  describe('restrictionError', () => {
    it('explique la première action interdite', () => {
      const rights = rightsOf(
        'member',
        { write: true, voice: false, call: true },
        { write: true, voice: true, call: false },
      );
      expect(restrictionError(rights, ['write'])).toBeNull();
      expect(restrictionError(rights, ['voice'])).toMatch(/administrateurs/);
      expect(restrictionError(rights, ['call'])).toMatch(/ne pouvez plus/);
    });
  });
});
