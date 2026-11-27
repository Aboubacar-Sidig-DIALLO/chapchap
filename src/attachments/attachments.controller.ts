import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import type { Attachment } from './attachment.types';
import {
  INLINE_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_DIR,
} from './attachments.constants';
import { AttachmentsService, type UploadFields } from './attachments.service';
import { parseByteRange } from './byte-range';

/** En-tête `Content-Disposition` avec un nom de fichier UTF-8 (RFC 6266). */
function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  /**
   * Réservé aux utilisateurs connectés (garde globale de Better Auth).
   * Le fichier est écrit directement sur disque (pas de mise en mémoire).
   * Un message vocal joint sa durée et sa forme d'onde (`durationMs`, `waveform`).
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        // Nom aléatoire sans extension : rien de prévisible ni d'exécutable sur le disque.
        filename: (_req, _file, done) => done(null, randomUUID()),
      }),
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() fields: UploadFields,
  ): Attachment {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    return this.attachmentsService.register(file, fields);
  }

  /**
   * Une pièce jointe à vue unique, remise à celui qui vient de l'ouvrir :
   * le ticket (aléatoire, valable une minute) ne sert qu'à lui, avec sa
   * session. Le fichier part d'un bloc, en téléchargement, sans cache : le
   * client le garde en mémoire le temps de l'affichage, puis l'oublie.
   */
  @Get('once/:ticket')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  openOnce(
    @Session() session: UserSession,
    @Param('ticket') ticket: string,
  ): StreamableFile {
    const stored = this.attachmentsService.redeem(ticket, session.user.id);
    if (!stored) throw new NotFoundException('Ce contenu a déjà disparu');

    const { name, size } = stored.attachment;
    return new StreamableFile(createReadStream(stored.path), {
      type: 'application/octet-stream',
      length: size,
      disposition: contentDisposition('attachment', name),
    });
  }

  /**
   * `?download` force le téléchargement, y compris pour une image.
   * Les requêtes partielles (`Range`) permettent de lire l'audio et de s'y déplacer.
   *
   * Public : l'identifiant, aléatoire (UUID), sert de clé d'accès. Les balises
   * `<img>` / `<audio>` qui chargent ces fichiers restent ainsi indépendantes
   * du cookie de session.
   *
   * Éphémère : introuvable une fois expirée, et le navigateur ne la garde
   * pas en cache au-delà de son expiration.
   */
  @Get(':id')
  @AllowAnonymous()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Accept-Ranges', 'bytes')
  download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
    @Headers('range') rangeHeader?: string,
  ): StreamableFile {
    const stored = this.attachmentsService.findPublic(id);
    if (!stored) throw new NotFoundException('Pièce jointe introuvable');

    const secondsLeft = Math.max(
      0,
      Math.floor((stored.expiresAt - Date.now()) / 1000),
    );
    res.setHeader('Cache-Control', `private, max-age=${secondsLeft}`);

    const { name, mimeType, size } = stored.attachment;
    const isInline = download === undefined && INLINE_TYPES.has(mimeType);

    const range = parseByteRange(rangeHeader, size);
    if (range === null) {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new HttpException(
        'Plage demandée invalide',
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }
    if (range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${size}`,
      );
    }

    return new StreamableFile(createReadStream(stored.path, range), {
      type: isInline ? mimeType : 'application/octet-stream',
      length: range ? range.end - range.start + 1 : size,
      disposition: contentDisposition(isInline ? 'inline' : 'attachment', name),
    });
  }
}
