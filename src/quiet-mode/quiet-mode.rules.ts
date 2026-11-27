/**
 * Règles des heures calmes, sans accès à la base — les mêmes côté client
 * (`chat-nextjs/src/features/quiet-mode/lib/rules.ts`).
 */

/** Minutes dans une journée : un horaire va de 0 (minuit) à 1439 (23:59). */
export const MINUTES_PER_DAY = 24 * 60;

export interface QuietSettings {
  /** Heures calmes chaque jour, de `startMinute` à `endMinute` (heure de `timeZone`). */
  scheduleEnabled: boolean;
  startMinute: number;
  endMinute: number;
  timeZone: string;
  /** Ne pas déranger, activé à la main, jusqu'à `manualUntil` (`null` : jusqu'à ce qu'il le désactive). */
  manualOn: boolean;
  manualUntil: Date | null;
}

export const DEFAULT_QUIET_SETTINGS: QuietSettings = {
  scheduleEnabled: false,
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  timeZone: 'UTC',
  manualOn: false,
  manualUntil: null,
};

/** Vrai si `timeZone` est un fuseau horaire IANA connu (« Europe/Paris »). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** L'heure qu'il est à `now` dans ce fuseau, en minutes depuis minuit. */
export function minuteOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: 'hour' | 'minute') =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/**
 * `minute` tombe-t-elle dans la plage ? Une plage qui passe minuit (22:00 →
 * 07:00) s'étend sur deux jours ; une plage vide (même début et fin) ne
 * couvre rien.
 */
export function isInRange(
  startMinute: number,
  endMinute: number,
  minute: number,
): boolean {
  if (startMinute === endMinute) return false;
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}

export function isManualActive(settings: QuietSettings, now: Date): boolean {
  return (
    settings.manualOn &&
    (settings.manualUntil === null || settings.manualUntil > now)
  );
}

/** L'utilisateur est-il dans ses heures calmes (ou en « ne pas déranger ») à `now` ? */
export function isQuietAt(settings: QuietSettings, now: Date): boolean {
  if (isManualActive(settings, now)) return true;
  return (
    settings.scheduleEnabled &&
    isValidTimeZone(settings.timeZone) &&
    isInRange(
      settings.startMinute,
      settings.endMinute,
      minuteOfDay(now, settings.timeZone),
    )
  );
}
