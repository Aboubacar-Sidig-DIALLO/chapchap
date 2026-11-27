import { z } from 'zod';
import { isValidTimeZone, MINUTES_PER_DAY } from './quiet-mode.rules';

/** Validation des entrées de l'API des heures calmes. */

/** Durée maximale d'un « ne pas déranger » daté : au-delà, on le choisit « sans fin ». */
export const MAX_MANUAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const minuteSchema = z
  .number()
  .int()
  .min(0)
  .max(MINUTES_PER_DAY - 1);

export const quietScheduleSchema = z.object({
  enabled: z.boolean(),
  startMinute: minuteSchema,
  endMinute: minuteSchema,
  timeZone: z
    .string()
    .max(64)
    .refine(isValidTimeZone, 'Fuseau horaire inconnu'),
});
export type QuietScheduleInput = z.infer<typeof quietScheduleSchema>;

export const quietManualSchema = z
  .object({
    on: z.boolean(),
    /** Fin du « ne pas déranger » ; absente ou `null` : jusqu'à ce qu'il le désactive. */
    until: z.iso.datetime().nullable().default(null),
  })
  .refine(
    ({ on, until }) => {
      if (!on || until === null) return true;
      const remaining = Date.parse(until) - Date.now();
      return remaining > 0 && remaining <= MAX_MANUAL_DURATION_MS;
    },
    { message: 'Choisissez une fin dans les 7 prochains jours' },
  );
export type QuietManualInput = z.infer<typeof quietManualSchema>;
