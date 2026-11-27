import { ChatService } from '../chat/chat.service';
import type { Conversation } from '../social/conversation-access.service';
import { OngoingCallsService } from '../social/ongoing-calls.service';
import type { CallTransport } from './call-transport';
import { CallCoordinator } from './call.coordinator';
import { CallService } from './call.service';

const group: Conversation = {
  key: 'group:g1',
  type: 'group',
  title: 'Projet',
  photoUrl: null,
  memberIds: ['alice', 'bob'],
  rightsByUser: {},
  groupId: 'g1',
};
const alice = { id: 'alice', name: 'Alice' };
const bob = { id: 'bob', name: 'Bob' };
const paul = { id: 'guest:1', name: 'Paul', isGuest: true };
const media = { audio: true, video: false };

function setup() {
  const callService = new CallService();
  const chatService = new ChatService();
  const transport = {
    participants: jest.fn(),
    signal: jest.fn(),
    reaction: jest.fn(),
    ended: jest.fn(),
    newMessage: jest.fn(),
  };
  const coordinator = new CallCoordinator(
    callService,
    chatService,
    new OngoingCallsService(),
    transport as unknown as CallTransport,
  );
  const ended: string[] = [];
  coordinator.ended$.subscribe((key) => ended.push(key));
  const join = (peerId: string, user: typeof alice) =>
    coordinator.join(callService.room(group), { peerId, user }, media);
  return { coordinator, callService, chatService, transport, ended, join };
}

describe('CallCoordinator (invités d’un appel de groupe)', () => {
  it('l’appel continue tant qu’il reste un membre avec l’invité', () => {
    const { coordinator, callService, join, ended } = setup();
    join('p-alice', alice);
    join('p-bob', bob);
    join('p-paul', paul);

    coordinator.leave(group.key, 'p-alice');
    expect(
      callService
        .find(group.key)
        ?.list()
        .map((p) => p.peerId),
    ).toEqual(['p-bob', 'p-paul']);
    expect(ended).toEqual([]);
  });

  it('un invité ne reste jamais seul : sans membre, l’appel prend fin pour lui', () => {
    const { coordinator, callService, transport, chatService, join, ended } =
      setup();
    join('p-alice', alice);
    join('p-paul', paul);

    coordinator.leave(group.key, 'p-alice');
    expect(transport.ended).toHaveBeenCalledWith(['p-paul']);
    expect(callService.find(group.key)).toBeNull();
    // Fin annoncée (accès des invités effacés), trace déposée au nom d'un membre.
    expect(ended).toEqual([group.key]);
    const [trace] = chatService.conversation(group.key).getHistory();
    expect(trace.author).toEqual(alice);
    expect(trace.call?.participants).toEqual([alice, paul]);
  });

  it('le départ d’un invité ne termine pas l’appel', () => {
    const { coordinator, callService, join, ended } = setup();
    join('p-alice', alice);
    join('p-paul', paul);
    coordinator.leave(group.key, 'p-paul');
    expect(callService.find(group.key)?.hasMembers()).toBe(true);
    expect(ended).toEqual([]);
  });

  it('ne relaie un signal qu’entre participants du même appel', () => {
    const { coordinator, transport, join } = setup();
    join('p-alice', alice);
    join('p-paul', paul);

    coordinator.signal(group.key, 'p-paul', { peerId: 'p-alice', data: {} });
    expect(transport.signal).toHaveBeenCalledWith('p-alice', {
      peerId: 'p-paul',
      data: {},
    });

    transport.signal.mockClear();
    coordinator.signal(group.key, 'p-paul', { peerId: 'ailleurs', data: {} });
    coordinator.signal(group.key, 'intrus', { peerId: 'p-alice', data: {} });
    expect(transport.signal).not.toHaveBeenCalled();
  });
});
