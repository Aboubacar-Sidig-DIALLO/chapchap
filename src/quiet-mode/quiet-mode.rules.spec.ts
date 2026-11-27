import {
  DEFAULT_QUIET_SETTINGS,
  isInRange,
  isQuietAt,
  isValidTimeZone,
  minuteOfDay,
  type QuietSettings,
} from './quiet-mode.rules';

const at = (iso: string) => new Date(iso);
const nightly: QuietSettings = {
  ...DEFAULT_QUIET_SETTINGS,
  scheduleEnabled: true,
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  timeZone: 'Europe/Paris',
};

describe('Heures calmes (règles)', () => {
  it('lit l’heure dans le fuseau de l’utilisateur', () => {
    // 21:30 UTC en hiver = 22:30 à Paris.
    expect(minuteOfDay(at('2026-01-15T21:30:00Z'), 'Europe/Paris')).toBe(
      22 * 60 + 30,
    );
    expect(minuteOfDay(at('2026-01-15T21:30:00Z'), 'UTC')).toBe(21 * 60 + 30);
  });

  it('une plage peut passer minuit, une plage vide ne couvre rien', () => {
    expect(isInRange(22 * 60, 7 * 60, 23 * 60)).toBe(true);
    expect(isInRange(22 * 60, 7 * 60, 6 * 60 + 59)).toBe(true);
    expect(isInRange(22 * 60, 7 * 60, 7 * 60)).toBe(false);
    expect(isInRange(13 * 60, 14 * 60, 13 * 60 + 30)).toBe(true);
    expect(isInRange(9 * 60, 9 * 60, 9 * 60)).toBe(false);
  });

  it('suit l’horaire quotidien quand il est activé', () => {
    expect(isQuietAt(nightly, at('2026-01-15T22:30:00Z'))).toBe(true); // 23:30 à Paris
    expect(isQuietAt(nightly, at('2026-01-15T12:00:00Z'))).toBe(false); // 13:00
    expect(
      isQuietAt(
        { ...nightly, scheduleEnabled: false },
        at('2026-01-15T22:30:00Z'),
      ),
    ).toBe(false);
  });

  it('« ne pas déranger » à la main, jusqu’à une heure donnée ou sans fin', () => {
    const now = at('2026-01-15T12:00:00Z');
    const manual = { ...DEFAULT_QUIET_SETTINGS, manualOn: true };
    expect(isQuietAt({ ...manual, manualUntil: null }, now)).toBe(true);
    expect(
      isQuietAt({ ...manual, manualUntil: at('2026-01-15T13:00:00Z') }, now),
    ).toBe(true);
    expect(
      isQuietAt({ ...manual, manualUntil: at('2026-01-15T11:00:00Z') }, now),
    ).toBe(false);
  });

  it('ignore un fuseau horaire inconnu', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Nulle/Part')).toBe(false);
    expect(
      isQuietAt(
        { ...nightly, timeZone: 'Nulle/Part' },
        at('2026-01-15T22:30:00Z'),
      ),
    ).toBe(false);
  });
});
