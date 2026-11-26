import type { Conversation } from '../social/conversation-access.service';
import { CallRoom } from './call.service';

const direct: Conversation = {
  key: 'direct:ana:bob',
  type: 'direct',
  title: 'Bob',
  memberIds: ['ana', 'bob'],
  friendId: 'bob',
};
const group: Conversation = {
  key: 'group:g1',
  type: 'group',
  title: 'Café',
  memberIds: ['ana', 'bob', 'cleo'],
  groupId: 'g1',
};
const ana = { id: 'ana', name: 'Ana' };
const bob = { id: 'bob', name: 'Bob' };
const audio = { audio: true, video: false };

describe('CallRoom', () => {
  describe('entre amis', () => {
    it('sonne tant que l’appelé n’a pas répondu', () => {
      const room = new CallRoom(direct);
      room.join('p1', ana, audio);
      expect(room.isRinging()).toBe(true);

      room.join('p2', bob, audio);
      expect(room.isRinging()).toBe(false);
      expect(room.isFull()).toBe(true);
    });

    it('raccrocher termine l’appel pour les deux, avec sa trace', () => {
      const room = new CallRoom(direct);
      room.join('p1', ana, audio);
      room.join('p2', bob, audio);

      room.leave('p1');
      expect(room.clear().map((p) => p.peerId)).toEqual(['p2']);

      const summary = room.endIfEmpty();
      expect(summary?.participants).toEqual([ana, bob]);
      expect(summary?.declined).toBe(false);
      expect(room.endIfEmpty()).toBeNull();
    });

    it('note un refus, sans durée de conversation', () => {
      const room = new CallRoom(direct);
      room.join('p1', ana, audio);
      room.markDeclined();
      room.clear();

      const summary = room.endIfEmpty();
      expect(summary).toMatchObject({ declined: true, durationMs: 0 });
      expect(summary?.participants).toEqual([ana]);
    });

    it('ne sonne plus une fois décroché, même si l’un se reconnecte', () => {
      const room = new CallRoom(direct);
      room.join('p1', ana, audio);
      room.join('p2', bob, audio);
      room.leave('p2');
      expect(room.isRinging()).toBe(false);
    });
  });

  describe('en groupe', () => {
    it('ne sonne jamais et reste ouvert quand quelqu’un part', () => {
      const room = new CallRoom(group);
      room.join('p1', ana, audio);
      expect(room.isRinging()).toBe(false);

      room.join('p2', bob, audio);
      room.leave('p1');
      expect(room.endIfEmpty()).toBeNull();
      expect(room.hasUser('bob')).toBe(true);
    });
  });
});
