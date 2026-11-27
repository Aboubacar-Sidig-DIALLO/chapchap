import { MESSAGE_TTL_MS } from './chat.constants';
import { ChatService } from './chat.service';
import { ConversationStore } from './conversation-store';

const alice = { id: 'alice', name: 'Alice' };
const createdAt = '2026-01-01T12:00:00.000Z';
const sentAt = Date.parse(createdAt);

function send(store: ConversationStore, id: string) {
  return store.addMessage({
    id,
    author: alice,
    content: 'Bonjour',
    attachments: [],
    createdAt,
  }).message;
}

describe('ConversationStore (messages éphémères)', () => {
  describe("changements par l'auteur tant que personne ne l'a vu", () => {
    const bob = { id: 'bob', name: 'Bob' };
    const photo = {
      id: 'a1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 1,
      url: '/attachments/a1',
    };

    function sendWithPhoto(store: ConversationStore) {
      return store.addMessage({
        id: 'm1',
        author: alice,
        content: 'Regarde',
        attachments: [photo],
        createdAt,
      }).message;
    }

    it('corrige le texte et le marque comme modifié', () => {
      const store = new ConversationStore();
      send(store, 'm1');
      const result = store.editMessage('m1', alice, 'Bonsoir');
      expect(result).toMatchObject({ ok: true, changed: true });
      expect(store.getHistory()[0].content).toBe('Bonsoir');
      expect(store.getHistory()[0].editedAt).toBeDefined();
    });

    it("refuse dès qu'un autre l'a lu, ou si ce n'est pas l'auteur", () => {
      const store = new ConversationStore();
      const message = send(store, 'm1');
      expect(store.editMessage('m1', bob, 'X')).toMatchObject({ ok: false });

      // Reçu seulement : encore modifiable ; lu : verrouillé.
      store.updateReceipt(bob, { deliveredSeq: message.seq });
      expect(store.editMessage('m1', alice, 'Salut').ok).toBe(true);
      store.updateReceipt(bob, { readSeq: message.seq });
      expect(store.editMessage('m1', alice, 'Coucou').ok).toBe(false);
      expect(store.unsendMessage('m1', alice).ok).toBe(false);
    });

    it("ne compte pas la lecture de l'auteur lui-même", () => {
      const store = new ConversationStore();
      const message = send(store, 'm1');
      store.updateReceipt(alice, { readSeq: message.seq });
      expect(store.unsendMessage('m1', alice).ok).toBe(true);
      expect(store.getHistory()).toHaveLength(0);
    });

    it('retire une pièce jointe, puis le message une fois vide', () => {
      const store = new ConversationStore();
      sendWithPhoto(store);
      expect(store.editMessage('m1', alice, '')).toMatchObject({ ok: true });

      const result = store.removeAttachment('m1', 'a1', alice);
      expect(result).toMatchObject({
        ok: true,
        attachment: photo,
        message: null,
      });
      expect(store.getHistory()).toHaveLength(0);
    });

    it("refuse de vider le texte d'un message sans pièce jointe", () => {
      const store = new ConversationStore();
      send(store, 'm1');
      expect(store.editMessage('m1', alice, '').ok).toBe(false);
    });
  });

  it('supprime un message pour tous en ne gardant que la mention du modérateur', () => {
    const store = new ConversationStore();
    const moderator = { id: 'bob', name: 'Bob' };
    send(store, 'm1');
    store.setReaction('m1', moderator, '❤️');

    expect(store.deleteMessage('m1', moderator)).toEqual([]);
    expect(store.getHistory()[0]).toMatchObject({
      content: '',
      attachments: [],
      reactions: [],
      deletedBy: moderator,
    });
    // Déjà supprimé : plus rien à faire, ni réaction possible.
    expect(store.deleteMessage('m1', moderator)).toBeNull();
    expect(store.setReaction('m1', alice, '❤️')).toBeNull();
    expect(store.deleteMessage('inconnu', moderator)).toBeNull();
  });

  it('fixe la fin de vie d’un message une heure après son envoi', () => {
    const message = send(new ConversationStore(), 'm1');
    expect(Date.parse(message.expiresAt) - sentAt).toBe(MESSAGE_TTL_MS);
  });

  it('garde un message jusqu’à son expiration, puis l’efface', () => {
    const store = new ConversationStore();
    send(store, 'm1');

    expect(store.pruneExpired(sentAt + MESSAGE_TTL_MS - 1)).toBe(false);
    expect(store.getHistory()).toHaveLength(1);

    expect(store.pruneExpired(sentAt + MESSAGE_TTL_MS)).toBe(true);
    expect(store.getHistory()).toHaveLength(0);
  });
});

describe('ChatService (ménage des conversations)', () => {
  it('oublie une conversation vide où plus personne n’est connecté', () => {
    const service = new ChatService();
    const store = service.conversation('direct:a:b');
    send(store, 'm1');

    service.removeExpired(sentAt + MESSAGE_TTL_MS);

    // Une nouvelle conversation, vierge, est créée à la demande.
    expect(service.conversation('direct:a:b')).not.toBe(store);
  });

  it('garde une conversation vide tant que quelqu’un y est connecté', () => {
    const service = new ChatService();
    const store = service.conversation('group:g1');
    service.addConnection('socket-1', alice, 'group:g1');

    service.removeExpired(sentAt + MESSAGE_TTL_MS);

    expect(service.conversation('group:g1')).toBe(store);
  });

  it('efface tous les messages d’une conversation fermée', () => {
    const service = new ChatService();
    send(service.conversation('direct:a:b'), 'm1');

    service.deleteConversation('direct:a:b');

    expect(service.conversation('direct:a:b').getHistory()).toHaveLength(0);
  });
});
