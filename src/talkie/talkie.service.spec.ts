import {
  BURST_ALLOWANCE_MS,
  MAX_TALK_MS,
  TALKIE_BYTES_PER_SECOND,
} from './talkie.constants';
import { TalkieService } from './talkie.service';

const key = 'direct:ana:bob';
const ana = { id: 'ana', name: 'Ana' };
const bob = { id: 'bob', name: 'Bob' };

describe('TalkieService', () => {
  let service: TalkieService;

  beforeEach(() => {
    service = new TalkieService();
  });

  it('donne la parole à une seule voix à la fois', () => {
    expect(service.claim(key, 's1', ana, 'm1').ok).toBe(true);
    expect(service.claim(key, 's2', bob, 'm2')).toEqual({
      ok: false,
      speaker: ana,
    });
    expect(service.current(key)?.id).toBe('m1');
  });

  it('laisse la même connexion reprendre la parole', () => {
    service.claim(key, 's1', ana, 'm1');
    expect(service.claim(key, 's1', ana, 'm2').ok).toBe(true);
    expect(service.current(key)?.id).toBe('m2');
  });

  it('rend la parole seulement à celui qui la tient', () => {
    service.claim(key, 's1', ana, 'm1');
    expect(service.release(key, 's2')).toBeNull();
    expect(service.release(key, 's1')?.id).toBe('m1');
    expect(service.current(key)).toBeNull();
    expect(service.claim(key, 's2', bob, 'm2').ok).toBe(true);
  });

  it("ignore le son d'une autre connexion que l'orateur", () => {
    service.claim(key, 's1', ana, 'm1', { now: 0 });
    expect(service.accept(key, 's2', 100, 0)).toBe('ignored');
    expect(service.accept('group:x', 's1', 100, 0)).toBe('ignored');
  });

  it('accepte le débit d’une voix, avance de départ comprise', () => {
    service.claim(key, 's1', ana, 'm1', { now: 0 });
    const burst = (BURST_ALLOWANCE_MS / 1000) * TALKIE_BYTES_PER_SECOND;
    expect(service.accept(key, 's1', burst, 0)).toBe('ok');
    expect(service.accept(key, 's1', TALKIE_BYTES_PER_SECOND, 1000)).toBe('ok');
  });

  it('coupe un débit anormal', () => {
    service.claim(key, 's1', ana, 'm1', { now: 0 });
    const burst = (BURST_ALLOWANCE_MS / 1000) * TALKIE_BYTES_PER_SECOND;
    expect(service.accept(key, 's1', burst + 2, 0)).toBe('over');
  });

  it('coupe au-delà de la durée maximale', () => {
    service.claim(key, 's1', ana, 'm1', { now: 0 });
    expect(service.accept(key, 's1', 2, MAX_TALK_MS + 1)).toBe('over');
  });
});
