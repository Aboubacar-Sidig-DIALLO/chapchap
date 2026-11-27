import type { Attachment } from '../attachments/attachment.types';
import type { ViewOnceItem, ViewOnceKind } from './chat.types';

/**
 * Vue unique : un vocal, une photo, une vidéo ou un fichier que chaque
 * destinataire n'ouvre qu'une fois. Son contenu ne circule jamais avec le
 * message : seule l'annonce de ce qu'il contient (« Vocal · 0:12 ») est
 * diffusée, et le fichier n'est remis qu'à l'ouverture, par un ticket à
 * usage court (voir `AttachmentsService.issueTicket`).
 */

/**
 * Durée de validité d'un ticket d'ouverture : le temps de télécharger le
 * fichier, pas de le garder. Passé ce délai, le lien ne mène plus à rien.
 */
export const VIEW_ONCE_TICKET_TTL_MS = 60 * 1000;

/** Vidéos qu'un navigateur lit sans module : affichées dans la visionneuse. */
const PLAYABLE_VIDEO_TYPES: ReadonlySet<string> = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

/** Ce qu'est une pièce jointe, vue de l'extérieur (rien de son contenu). */
export function viewOnceKind(attachment: Attachment): ViewOnceKind {
  if (attachment.voice || attachment.mimeType.startsWith('audio/')) {
    return 'voice';
  }
  if (attachment.image) return 'image';
  if (PLAYABLE_VIDEO_TYPES.has(attachment.mimeType)) return 'video';
  return 'file';
}

/** L'annonce publique d'une pièce jointe : son genre et, pour un vocal, sa durée. */
export function toViewOnceItem(attachment: Attachment): ViewOnceItem {
  const kind = viewOnceKind(attachment);
  return attachment.voice
    ? { kind, durationMs: attachment.voice.durationMs }
    : { kind };
}
