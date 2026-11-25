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
    const store = service.conversation('salon');
    service.addConnection('socket-1', alice, 'salon');

    service.removeExpired(sentAt + MESSAGE_TTL_MS);

    expect(service.conversation('salon')).toBe(store);
  });

  it('efface tous les messages d’une conversation fermée', () => {
    const service = new ChatService();
    send(service.conversation('direct:a:b'), 'm1');

    service.deleteConversation('direct:a:b');

    expect(service.conversation('direct:a:b').getHistory()).toHaveLength(0);
  });
});
