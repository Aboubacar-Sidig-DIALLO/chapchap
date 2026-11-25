import { join } from 'node:path';

/** Limites — à garder synchronisées avec le client (`features/chat/lib/config.ts`). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_VOICE_DURATION_MS = 5 * 60 * 1000; // 5 min
/** Nombre maximal de barres de la forme d'onde d'un message vocal. */
export const MAX_WAVEFORM_BARS = 64;

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

/**
 * Seuls ces formats (images et audio) sont servis tels quels au navigateur ;
 * tout le reste (SVG, HTML…) est servi en téléchargement pour empêcher
 * l'exécution de contenu actif (XSS).
 */
export const INLINE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
]);
