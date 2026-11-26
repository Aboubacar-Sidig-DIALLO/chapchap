import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroupPhotosService } from './group-photos.service';

describe('GroupPhotosService', () => {
  let dir: string;
  let service: GroupPhotosService;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'group-photos-'));
    process.env.GROUP_PHOTO_DIR = dir;
    service = new GroupPhotosService();
    await service.onModuleInit();
  });

  afterAll(async () => {
    delete process.env.GROUP_PHOTO_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it('enregistre une image reconnue à sa signature, pas à son nom', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
    const name = await service.save(png);
    expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(service.find(name)?.mimeType).toBe('image/png');
    expect(await readdir(dir)).toContain(name);
  });

  it('refuse ce qui n’est pas une image', async () => {
    await expect(
      service.save(Buffer.from('<svg onload=alert(1)>')),
    ).rejects.toThrow('Choisissez une image JPEG, PNG ou WebP');
  });

  it('ne sert que des noms de photo valides', () => {
    expect(service.find('../../.env')).toBeNull();
    expect(service.find('photo.svg')).toBeNull();
    expect(
      service.find('00000000-0000-0000-0000-000000000000.jpg'),
    ).not.toBeNull();
  });
});
