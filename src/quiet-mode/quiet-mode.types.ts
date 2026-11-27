/** Contrat de l'API des heures calmes — à garder synchronisé avec le front (`chat-nextjs/src/features/quiet-mode/types.ts`). */

/** Les réglages d'un utilisateur, tels que le client les affiche et les modifie. */
export interface QuietModeState {
  /** Heures calmes chaque jour (heure du fuseau `timeZone`). */
  schedule: {
    enabled: boolean;
    /** Minutes depuis minuit (0 à 1439). */
    startMinute: number;
    endMinute: number;
    timeZone: string;
  };
  /** Ne pas déranger, activé à la main ; `until` : date ISO 8601, ou `null` jusqu'à ce qu'il le désactive. */
  manual: { on: boolean; until: string | null };
}
