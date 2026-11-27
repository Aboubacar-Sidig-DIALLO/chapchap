import type { ChatMessage } from '../chat/chat.types';
import type {
  ConversationTarget,
  PublicUser,
  SocialNotice,
} from '../social/social.types';
import { FRONT_ROUTES } from './push.config';
import type { MessagePreview, PushNotification } from './push.types';

/**
 * Le texte des notifications push, en français. Jamais le contenu d'un
 * message : la notification dit qui écrit et quel genre de message, comme
 * l'accueil.
 */

/** Ce que contient un message (vocal, photos, fichiers ou texte), sans son contenu. */
export function messagePreview(
  message: Pick<ChatMessage, 'attachments'>,
): MessagePreview {
  const { attachments } = message;
  const voice = attachments.find((attachment) => attachment.voice);
  if (voice?.voice) {
    return { type: 'voice', durationMs: voice.voice.durationMs };
  }

  const photos = attachments.filter((attachment) => attachment.image);
  if (photos.length > 0 && photos.length === attachments.length) {
    return { type: 'photo', count: photos.length };
  }
  if (attachments.length > 0) {
    return { type: 'file', count: attachments.length };
  }
  return { type: 'text' };
}

/** « 0:42 » */
function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function describe(preview: MessagePreview) {
  switch (preview.type) {
    case 'voice':
      return `🎙️ Message vocal · ${formatDuration(preview.durationMs)}`;
    case 'photo':
      return preview.count > 1 ? `📷 ${preview.count} photos` : '📷 Photo';
    case 'file':
      return preview.count > 1 ? `📎 ${preview.count} fichiers` : '📎 Fichier';
    case 'text':
      return 'Nouveau message';
  }
}

/** Page de la conversation, et clé qui regroupe ses notifications. */
function conversationOf(target: ConversationTarget) {
  return target.type === 'direct'
    ? {
        key: `direct:${target.userId}`,
        url: FRONT_ROUTES.friend(target.userId),
      }
    : {
        key: `group:${target.groupId}`,
        url: FRONT_ROUTES.group(target.groupId),
      };
}

export function messageNotification(
  target: ConversationTarget,
  from: PublicUser,
  preview: MessagePreview,
  createdAt: string,
): PushNotification {
  const { key, url } = conversationOf(target);
  const body = describe(preview);
  return {
    tag: `message:${key}`,
    kind: 'message',
    title: target.type === 'group' ? target.groupName : from.name,
    body: target.type === 'group' ? `${from.name} : ${body}` : body,
    url,
    createdAt,
  };
}

export function callNotification(
  target: ConversationTarget,
  startedBy: PublicUser,
  createdAt: string,
): PushNotification {
  const { key, url } = conversationOf(target);
  return {
    tag: `call:${key}`,
    kind: 'call',
    ...(target.type === 'group'
      ? {
          title: target.groupName,
          body: `${startedBy.name} a lancé un direct · touchez pour rejoindre`,
        }
      : {
          title: `${startedBy.name} vous appelle`,
          body: 'Touchez pour répondre',
        }),
    url: FRONT_ROUTES.joinCall(url),
    createdAt,
  };
}

export function socialNotification(
  notice: SocialNotice,
  createdAt: string,
): PushNotification {
  const base = {
    tag: `social:${notice.type}:${notice.user.id}`,
    kind: 'social' as const,
    url: FRONT_ROUTES.home,
    createdAt,
  };
  switch (notice.type) {
    case 'friend-request':
      return {
        ...base,
        title: notice.user.name,
        body: 'Vous a envoyé une demande d’ami',
      };
    case 'friend-accepted':
      return {
        ...base,
        title: notice.user.name,
        body: 'A accepté votre demande d’ami',
      };
    case 'group-added':
      return {
        ...base,
        title: notice.groupName,
        body: `${notice.user.name} vous a ajouté au groupe`,
      };
  }
}
