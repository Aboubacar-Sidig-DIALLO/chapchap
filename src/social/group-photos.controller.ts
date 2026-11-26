import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { GroupPhotosService } from './group-photos.service';

@Controller('group-photos')
export class GroupPhotosController {
  constructor(private readonly groupPhotos: GroupPhotosService) {}

  /**
   * `GET /group-photos/:photo` : la photo d'un groupe.
   *
   * Public, comme les pièces jointes : le nom, aléatoire (UUID), sert de clé
   * d'accès et n'est communiqué qu'aux membres. Il change à chaque nouvelle
   * photo : le navigateur peut donc la garder en cache indéfiniment.
   */
  @Get(':photo')
  @AllowAnonymous()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async download(@Param('photo') name: string): Promise<StreamableFile> {
    const photo = this.groupPhotos.find(name);
    const size = photo
      ? await stat(photo.path).then(
          (stats) => stats.size,
          () => null,
        )
      : null;
    if (!photo || size === null) {
      throw new NotFoundException('Photo introuvable');
    }

    return new StreamableFile(createReadStream(photo.path), {
      type: photo.mimeType,
      length: size,
      disposition: 'inline',
    });
  }
}
