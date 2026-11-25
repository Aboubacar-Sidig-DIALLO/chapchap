import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CLEANUP_INTERVAL_MS, MESSAGE_TTL_MS } from '../chat/chat.constants';
import type {
  Attachment,
  ImageMetadata,
  VoiceMetadata,
} from './attachment.types';
import {
  INLINE_TYPES,
  MAX_VOICE_DURATION_MS,
  MAX_WAVEFORM_BARS,
  UPLOAD_DIR,
} from './attachments.constants';

const MAX_NAME_LENGTH = 255;
/** Côté maximal accepté pour les dimensions annoncées d'une image (px). */
const MAX_IMAGE_SIDE = 20_000;

interface StoredAttachment {
  attachment: Attachment;
  /** Emplacement du fichier sur le disque. */
  path: string;
  /** Horodatage (ms) à partir duquel le fichier est supprimé. */
  expiresAt: number;
}

/** Champs texte envoyés avec le fichier (formulaire multipart). */
export type UploadFields = Partial<
  Record<'durationMs' | 'waveform' | 'width' | 'height' | 'color', unknown>
>;

/**
 * Multer décode le nom de fichier en latin1 alors que les navigateurs l'envoient
 * en UTF-8 : sans cette conversion, « photo été.jpg » deviendrait « photo Ã©tÃ©.jpg ».
 */
function decodeFileName(originalName: string) {
  const name = Buffer.from(originalName, 'latin1').toString('utf8').trim();
  return name.slice(0, MAX_NAME_LENGTH) || 'fichier';
}

/** `audio/webm;codecs=opus` → `audio/webm`. */
function normalizeMimeType(mimeType: string) {
  return (
    mimeType.split(';')[0].trim().toLowerCase() || 'application/octet-stream'
  );
}

function isWaveform(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_WAVEFORM_BARS &&
    value.every(
      (level) => Number.isInteger(level) && level >= 0 && level <= 100,
    )
  );
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Métadonnées d'un vocal, si elles sont valides. Elles ne viennent que du
 * client : des valeurs incohérentes sont ignorées plutôt que de bloquer l'envoi.
 */
function parseVoiceMetadata(
  mimeType: string,
  fields: UploadFields,
): VoiceMetadata | undefined {
  if (!mimeType.startsWith('audio/')) return undefined;

  const durationMs = Number(fields.durationMs);
  if (
    !Number.isInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_VOICE_DURATION_MS
  ) {
    return undefined;
  }

  const waveform = parseJson(fields.waveform);
  return { durationMs, waveform: isWaveform(waveform) ? waveform : [] };
}

function isImageSide(value: number) {
  return Number.isInteger(value) && value > 0 && value <= MAX_IMAGE_SIDE;
}

/** Métadonnées d'une image affichable, si elles sont valides (sinon ignorées). */
function parseImageMetadata(
  mimeType: string,
  fields: UploadFields,
): ImageMetadata | undefined {
  if (!mimeType.startsWith('image/') || !INLINE_TYPES.has(mimeType)) {
    return undefined;
  }

  const width = Number(fields.width);
  const height = Number(fields.height);
  const { color } = fields;
  if (
    !isImageSide(width) ||
    !isImageSide(height) ||
    typeof color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(color)
  ) {
    return undefined;
  }

  return { width, height, color: color.toLowerCase() };
}

/** Les fichiers enregistrés portent un UUID pour nom (voir le contrôleur) : rien d'autre n'est supprimé. */
const STORED_FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Registre des pièces jointes, éphémère comme les messages : les métadonnées
 * sont en mémoire, les fichiers sur disque le temps de leur durée de vie
 * (une heure après l'envoi du message), puis supprimés.
 */
@Injectable()
export class AttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Attachments');
  private readonly attachments = new Map<string, StoredAttachment>();
  private cleanupTimer?: NodeJS.Timeout;

  /**
   * Au démarrage, les métadonnées en mémoire ont disparu : les fichiers
   * restés sur disque (arrêt du serveur) sont orphelins et supprimés.
   */
  async onModuleInit() {
    await this.removeOrphanFiles();
    this.cleanupTimer = setInterval(
      () => void this.removeExpired(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  register(file: Express.Multer.File, fields: UploadFields = {}): Attachment {
    const id = file.filename;
    const mimeType = normalizeMimeType(file.mimetype);
    const voice = parseVoiceMetadata(mimeType, fields);
    const image = parseImageMetadata(mimeType, fields);

    const attachment: Attachment = {
      id,
      name: decodeFileName(file.originalname),
      mimeType,
      size: file.size,
      url: `/attachments/${id}`,
      ...(voice && { voice }),
      ...(image && { image }),
    };

    // Un fichier jamais envoyé dans un message disparaît lui aussi au bout d'une heure.
    this.attachments.set(id, {
      attachment,
      path: file.path,
      expiresAt: Date.now() + MESSAGE_TTL_MS,
    });
    return attachment;
  }

  /** La pièce jointe, tant qu'elle n'a pas expiré. */
  find(id: string): StoredAttachment | undefined {
    const stored = this.attachments.get(id);
    return stored && stored.expiresAt > Date.now() ? stored : undefined;
  }

  /** Résout les ids envoyés par le client ; `null` si l'un d'eux est inconnu ou expiré. */
  resolve(ids: unknown[]): Attachment[] | null {
    const attachments: Attachment[] = [];

    for (const id of new Set(ids)) {
      const stored = typeof id === 'string' ? this.find(id) : undefined;
      if (!stored) return null;
      attachments.push(stored.attachment);
    }

    return attachments;
  }

  /** Aligne la durée de vie des fichiers sur celle du message qui les contient. */
  keepUntil(attachments: Attachment[], expiresAt: string) {
    const until = Date.parse(expiresAt);
    for (const { id } of attachments) {
      const stored = this.attachments.get(id);
      if (stored) stored.expiresAt = Math.max(stored.expiresAt, until);
    }
  }

  /** Supprime les pièces jointes expirées : métadonnées et fichiers. */
  async removeExpired(now = Date.now()) {
    const expired = [...this.attachments].filter(
      ([, stored]) => stored.expiresAt <= now,
    );
    for (const [id, stored] of expired) {
      this.attachments.delete(id);
      await rm(stored.path, { force: true }).catch((error: unknown) =>
        this.logger.error(`Suppression impossible de ${id} : ${String(error)}`),
      );
    }
  }

  private async removeOrphanFiles() {
    const names = await readdir(UPLOAD_DIR).catch(() => [] as string[]);
    const orphans = names.filter((name) => STORED_FILE_NAME.test(name));
    await Promise.all(
      orphans.map((name) => rm(join(UPLOAD_DIR, name), { force: true })),
    );
    if (orphans.length > 0) {
      this.logger.log(
        `${orphans.length} fichier(s) d'une session précédente supprimé(s)`,
      );
    }
  }
}
