import type { PrismaClient } from '../generated/prisma/client';
import { PresenceService } from './presence.service';
import type { PresenceChange } from './social.types';

function setup() {
  const update = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { user: { updateMany: update } } as unknown as PrismaClient;
  const presence = new PresenceService(prisma);
  const changes: PresenceChange[] = [];
  presence.changes$.subscribe((change) => changes.push(change));
  return { presence, changes, update };
}

/** Laisse s'écouler le délai de grâce et l'enregistrement en base. */
async function afterGrace() {
  await jest.advanceTimersByTimeAsync(6000);
}

describe('PresenceService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('annonce une arrivée à la première connexion seulement', () => {
    const { presence, changes } = setup();
    presence.connected('alice');
    presence.connected('alice'); // second onglet

    expect(presence.isOnline('alice')).toBe(true);
    expect(changes).toEqual([
      { userId: 'alice', online: true, lastSeenAt: null },
    ]);
  });

  it('reste en ligne tant qu’une connexion est ouverte', async () => {
    const { presence, changes } = setup();
    presence.connected('alice');
    presence.connected('alice');
    presence.disconnected('alice');
    await afterGrace();

    expect(presence.isOnline('alice')).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it('ne clignote pas en passant d’une page à l’autre (délai de grâce)', async () => {
    const { presence, changes, update } = setup();
    presence.connected('alice');
    presence.disconnected('alice');
    presence.connected('alice');
    await afterGrace();

    expect(changes).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('passe hors ligne après le délai et enregistre la date de départ', async () => {
    const { presence, changes, update } = setup();
    presence.connected('alice');
    presence.disconnected('alice');
    await afterGrace();

    expect(presence.isOnline('alice')).toBe(false);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'alice' },
      data: { lastSeenAt: expect.any(Date) as Date },
    });
    expect(changes.at(-1)).toMatchObject({ userId: 'alice', online: false });
    expect(changes.at(-1)?.lastSeenAt).toEqual(expect.any(String));
  });
});
