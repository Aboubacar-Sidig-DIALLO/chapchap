import type { Conversation } from './conversation-access.service';
import {
  type OngoingCallUpdate,
  OngoingCallsService,
} from './ongoing-calls.service';

const group: Conversation = {
  key: 'group:g1',
  type: 'group',
  title: 'Café',
  memberIds: ['ana', 'bob', 'cleo'],
  groupId: 'g1',
};
const ana = { id: 'ana', name: 'Ana' };
const bob = { id: 'bob', name: 'Bob' };
const START = '2026-11-25T10:00:00.000Z';

describe('OngoingCallsService', () => {
  let service: OngoingCallsService;
  let updates: OngoingCallUpdate[];

  beforeEach(() => {
    service = new OngoingCallsService();
    updates = [];
    service.changes$.subscribe((update) => updates.push(update));
  });

  it('annonce le début d’un appel avec celui qui le lance', () => {
    service.update(group, [ana], START);

    expect(service.get(group.key)).toEqual({
      startedAt: START,
      participants: [{ id: 'ana', name: 'Ana', image: null }],
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].startedBy?.id).toBe('ana');
  });

  it('signale une arrivée sans refaire sonner', () => {
    service.update(group, [ana], START);
    service.update(group, [ana, bob], START);

    expect(updates).toHaveLength(2);
    expect(updates[1].startedBy).toBeNull();
    expect(updates[1].call?.participants.map((user) => user.id)).toEqual([
      'ana',
      'bob',
    ]);
  });

  it('ignore ce qui ne change pas les personnes présentes (micro, second onglet)', () => {
    service.update(group, [ana], START);
    service.update(group, [ana], START);
    service.update(group, [ana, ana], START);

    expect(updates).toHaveLength(1);
  });

  it('annonce la fin de l’appel, une seule fois', () => {
    service.update(group, [ana], START);
    service.update(group, [], START);
    service.update(group, [], null);

    expect(service.get(group.key)).toBeNull();
    expect(updates).toHaveLength(2);
    expect(updates[1].call).toBeNull();
  });

  it('ne suit pas le salon, ouvert à tous', () => {
    service.update(
      { key: 'salon', type: 'salon', title: 'Salon', memberIds: null },
      [ana],
      START,
    );

    expect(service.get('salon')).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
