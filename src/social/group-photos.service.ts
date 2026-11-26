import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';

/** Formats acceptés, reconnus à leur signature (jamais au type annoncé par le client). */
const FORMATS = [
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    matches: (bytes: Buffer) =>
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    extension: 'png',
    mimeType: 'image/png',
    matches: (bytes: Buffer) =>
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  {
    extension: 'webp',
    mimeType: 'image/webp',
    matches: (bytes: Buffer) =>
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP',
  },
] as const;

/** Nom d'un fichier stocké : un UUID aléatoire et son extension, rien d'autre. */
const PHOTO_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export interface StoredPhoto {
  path: string;
  mimeType: string;
}

/**
 * Photos de groupe, sur disque. Chaque photo reçoit un nom aléatoire et
 * nouveau à chaque changement : son adresse sert de clé d'accès et peut être
 * mise en cache indéfiniment.
 */
@Injectable()
export class GroupPhotosService implements OnModuleInit {
  private readonly logger = new Logger('GroupPhotos');
  /**
   * Dossier des photos. Distinct de celui des pièces jointes, qui est vidé à
   * chaque démarrage : une photo de groupe, elle, est durable.
   */
  private readonly dir =
    process.env.GROUP_PHOTO_DIR ??
    join(process.cwd(), 'storage', 'group-photos');

  async onModuleInit() {
    await mkdir(this.dir, { recursive: true });
  }

  /** Adresse publique d'une photo, relative à l'API. */
  static url(photo: string | null): string | null {
    return photo ? `/group-photos/${photo}` : null;
  }

  /** Enregistre une image (JPEG, PNG ou WebP) ; renvoie le nom du fichier. */
  async save(bytes: Buffer): Promise<string> {
    const format = FORMATS.find((candidate) => candidate.matches(bytes));
    if (!format) {
      throw new BadRequestException('Choisissez une image JPEG, PNG ou WebP');
    }
    const name = `${randomUUID()}.${format.extension}`;
    await writeFile(join(this.dir, name), bytes);
    return name;
  }

  /** La photo `name`, si ce nom est bien celui d'une photo stockée ; sinon `null`. */
  find(name: string): StoredPhoto | null {
    if (!PHOTO_NAME.test(name)) return null;
    const extension = name.slice(name.lastIndexOf('.') + 1);
    const format = FORMATS.find((item) => item.extension === extension);
    return format
      ? { path: join(this.dir, name), mimeType: format.mimeType }
      : null;
  }

  /** Supprime une photo remplacée ou celle d'un groupe disparu (sans effet si `null`). */
  async remove(name: string | null) {
    const photo = name ? this.find(name) : null;
    if (!photo) return;
    await rm(photo.path, { force: true }).catch((error: unknown) =>
      this.logger.warn(`Photo non supprimée : ${String(error)}`),
    );
  }
}
