import type { Attachment } from '../attachments/attachment.types';
import {
  callNotification,
  messageNotification,
  messagePreview,
  socialNotification,
} from './push.notifications';
import { subscriptionSchema } from './push.schemas';

const ana = { id: 'ana', name: 'Ana', image: null };
const at = '2026-11-28T12:00:00.000Z';
const direct = { type: 'direct' as const, userId: 'ana' };
const group = { type: 'group' as const, groupId: 'g1', groupName: 'Famille' };

function attachment(extra: Partial<Attachment>): Attachment {
  return {
    id: 'a1',
    name: 'fichier',
    mimeType: 'application/pdf',
    size: 10,
    url: '/attachments/a1',
    ...extra,
  };
}

describe('messagePreview', () => {
  it('reconnaît un vocal, des photos, des fichiers ou du texte', () => {
    expect(
      messagePreview({
        attachments: [
          attachment({ voice: { durationMs: 42_000, waveform: [] } }),
        ],
      }),
    ).toEqual({ type: 'voice', durationMs: 42_000 });
    const photo = attachment({
      image: { width: 1, height: 1, color: '#000000' },
    });
    expect(messagePreview({ attachments: [photo, photo] })).toEqual({
      type: 'photo',
      count: 2,
    });
    expect(messagePreview({ attachments: [photo, attachment({})] })).toEqual({
      type: 'file',
      count: 2,
    });
    expect(messagePreview({ attachments: [] })).toEqual({ type: 'text' });
  });
});

describe('notifications', () => {
  it('annonce un message privé sans son contenu', () => {
    expect(
      messageNotification(direct, ana, { type: 'text' }, at),
    ).toMatchObject({
      tag: 'message:direct:ana',
      title: 'Ana',
      body: 'Nouveau message',
      url: '/amis/ana',
    });
  });

  it('nomme l’auteur dans un groupe', () => {
    expect(
      messageNotification(
        group,
        ana,
        { type: 'voice', durationMs: 65_000 },
        at,
      ),
    ).toMatchObject({
      title: 'Famille',
      body: 'Ana : 🎙️ Message vocal · 1:05',
      url: '/groupes/g1',
    });
  });

  it('fait rejoindre l’appel au toucher', () => {
    expect(callNotification(direct, ana, at)).toMatchObject({
      kind: 'call',
      title: 'Ana vous appelle',
      url: '/amis/ana?rejoindre=appel',
    });
  });

  it('annonce une demande d’ami', () => {
    expect(
      socialNotification({ type: 'friend-request', user: ana }, at),
    ).toMatchObject({ title: 'Ana', url: '/' });
  });
});

describe('subscriptionSchema', () => {
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

  it('accepte un service push de navigateur', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
    ]) {
      expect(subscriptionSchema.safeParse({ endpoint, keys }).success).toBe(
        true,
      );
    }
  });

  it('refuse toute autre adresse (pas de requête vers le réseau interne)', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://localhost/push',
      'https://169.254.169.254/latest',
      'https://fcm.googleapis.com.evil.example/x',
      'pas une url',
    ]) {
      expect(subscriptionSchema.safeParse({ endpoint, keys }).success).toBe(
        false,
      );
    }
  });
});
