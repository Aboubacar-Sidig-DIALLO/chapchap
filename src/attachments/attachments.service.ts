import { Injectable } from '@nestjs/common';
import type {
  Attachment,
  ImageMetadata,
  VoiceMetadata,
} from './attachment.types';
import {
  INLINE_TYPES,
  MAX_VOICE_DURATION_MS,
  MAX_WAVEFORM_BARS,
} from './attachments.constants';

const MAX_NAME_LENGTH = 255;
/** Côté maximal accepté pour les dimensions annoncées d'une image (px). */
const MAX_IMAGE_SIDE = 20_000;

interface StoredAttachment {
  attachment: Attachment;
  /** Emplacement du fichier sur le disque. */
  path: string;
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

/**
 * Registre des pièces jointes. Les fichiers sont sur disque, les métadonnées
 * en mémoire (comme l'historique, elles sont perdues au redémarrage).
 */
@Injectable()
export class AttachmentsService {
  private readonly attachments = new Map<string, StoredAttachment>();

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

    this.attachments.set(id, { attachment, path: file.path });
    return attachment;
  }

  find(id: string): StoredAttachment | undefined {
    return this.attachments.get(id);
  }

  /** Résout les ids envoyés par le client ; `null` si l'un d'eux est inconnu. */
  resolve(ids: unknown[]): Attachment[] | null {
    const attachments: Attachment[] = [];

    for (const id of new Set(ids)) {
      const stored = typeof id === 'string' ? this.find(id) : undefined;
      if (!stored) return null;
      attachments.push(stored.attachment);
    }

    return attachments;
  }
}
