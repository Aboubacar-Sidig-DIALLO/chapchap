/**
 * Talkie-walkie : la voix part en direct pendant qu'on maintient le micro.
 * À garder synchronisé avec le client (`features/talkie/lib/config.ts`).
 */

/** Son transmis : PCM 16 bits, mono, 16 kHz (qualité voix, ~32 ko/s). */
export const TALKIE_SAMPLE_RATE = 16_000;
export const TALKIE_BYTES_PER_SECOND = TALKIE_SAMPLE_RATE * 2;

/** Un morceau de son (le client en envoie un toutes les 80 ms, soit ~2,5 ko). */
export const MAX_CHUNK_BYTES = 16 * 1024;

/** Même limite qu'un message vocal. */
export const MAX_TALK_MS = 5 * 60 * 1000;

/**
 * Avance tolérée sur le débit normal : le client peut envoyer d'un coup ce
 * qu'il a capté avant que la prise de parole soit acceptée.
 */
export const BURST_ALLOWANCE_MS = 3000;

/** Sans nouveau son pendant ce délai, la prise de parole est considérée comme finie. */
export const TALK_IDLE_TIMEOUT_MS = 4000;
