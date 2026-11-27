import { ConversationStore } from './conversation-store';
import { parseReplyTo } from './replies';

const alice = { id: 'alice', name: 'Alice' };
const bob = { id: 'bob', name: 'Bob' };
const createdAt = '2026-01-01T12:00:00.000Z';
const voice = {
  id: 'v1',
  name: 'vocal.webm',
  mimeType: 'audio/webm',
  size: 1,
  url: '/attachments/v1',
  voice: { durationMs: 60_000, waveform: [10, 50, 90] },
};

function setup() {
  const store = new ConversationStore();
  store.addMessage({
    id: 'text',
    author: alice,
    content: 'Salut',
    attachments: [],
    createdAt,
  });
  store.addMessage({
    id: 'voice',
    author: alice,
    content: '',
    attachments: [voice],
    createdAt,
  });
  const find = (id: string) => store.find(id);
  return { store, find };
}

describe('Réponses et moments d’un vocal', () => {
  describe('parseReplyTo', () => {
    it('sans référence, le message ne répond à rien', () => {
      const { find } = setup();
      expect(parseReplyTo(undefined, find)).toEqual({ ok: true });
      expect(parseReplyTo(null, find)).toEqual({ ok: true });
    });

    it('répond à un message, ou à un moment de son vocal', () => {
      const { find } = setup();
      expect(parseReplyTo({ messageId: 'text' }, find)).toEqual({
        ok: true,
        replyTo: { messageId: 'text' },
      });
      expect(parseReplyTo({ messageId: 'voice', atMs: 42_000 }, find)).toEqual({
        ok: true,
        replyTo: { messageId: 'voice', atMs: 42_000 },
      });
    });

    it('refuse un message disparu ou supprimé', () => {
      const { store, find } = setup();
      expect(parseReplyTo({ messageId: 'absent' }, find).ok).toBe(false);
      store.deleteMessage('text', bob);
      expect(parseReplyTo({ messageId: 'text' }, find).ok).toBe(false);
    });

    it('refuse un moment hors du vocal, ou sur un message sans vocal', () => {
      const { find } = setup();
      for (const atMs of [-1, 60_001, 1.5, '42', Number.NaN]) {
        expect(parseReplyTo({ messageId: 'voice', atMs }, find).ok).toBe(false);
      }
      expect(parseReplyTo({ messageId: 'text', atMs: 0 }, find).ok).toBe(false);
    });

    it('refuse une référence mal formée', () => {
      const { find } = setup();
      for (const raw of ['voice', 42, { messageId: 7 }, {}]) {
        expect(parseReplyTo(raw, find).ok).toBe(false);
      }
    });

    it('un vocal à écoute unique n’a pas de moments', () => {
      const store = new ConversationStore();
      store.addMessage(
        {
          id: 'once',
          author: alice,
          content: '',
          attachments: [voice],
          createdAt,
        },
        { viewOnceFor: ['bob'] },
      );
      const find = (id: string) => store.find(id);
      expect(parseReplyTo({ messageId: 'once' }, find).ok).toBe(true);
      expect(parseReplyTo({ messageId: 'once', atMs: 1000 }, find).ok).toBe(
        false,
      );
    });
  });

  describe('réaction à un moment', () => {
    it('pose « 🔥 à 0:42 », puis la déplace, puis la retire', () => {
      const { store } = setup();
      expect(store.setReaction('voice', bob, '🔥', 42_000)).toEqual([
        { user: bob, emoji: '🔥', atMs: 42_000 },
      ]);
      // Même emoji, même moment : rien ne change.
      expect(store.setReaction('voice', bob, '🔥', 42_000)).toBeNull();
      // Même emoji, autre moment : une seule réaction par participant, déplacée.
      expect(store.setReaction('voice', bob, '🔥', 10_000)).toEqual([
        { user: bob, emoji: '🔥', atMs: 10_000 },
      ]);
      // Sur tout le message : le moment disparaît.
      expect(store.setReaction('voice', bob, '🔥')).toEqual([
        { user: bob, emoji: '🔥' },
      ]);
      expect(store.setReaction('voice', bob, null)).toEqual([]);
      expect(store.setReaction('voice', bob, null)).toBeNull();
    });

    it('refuse un moment hors du vocal ou sur un message sans vocal', () => {
      const { store } = setup();
      expect(store.setReaction('voice', bob, '🔥', 61_000)).toBeNull();
      expect(store.setReaction('text', bob, '🔥', 0)).toBeNull();
      expect(store.find('voice')?.reactions).toEqual([]);
    });

    it('le vocal retiré, les réactions à ses moments valent pour tout le message', () => {
      const store = new ConversationStore();
      store.addMessage({
        id: 'm',
        author: alice,
        content: 'Écoute ça',
        attachments: [voice],
        createdAt,
      });
      store.setReaction('m', alice, '🔥', 5_000);
      const result = store.removeAttachment('m', 'v1', alice);
      expect(result.ok && result.message?.reactions).toEqual([
        { user: alice, emoji: '🔥' },
      ]);
    });
  });
});
