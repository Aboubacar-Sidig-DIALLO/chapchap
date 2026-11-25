/** Plage d'octets inclusive, ex. `{ start: 0, end: 1 }` pour les 2 premiers octets. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Lit un en-tête `Range` à plage unique (`bytes=0-1`, `bytes=100-`, `bytes=-500`).
 * Indispensable pour lire l'audio sur Safari (iOS), qui exige des réponses 206.
 *
 * @returns `undefined` sans en-tête (ou en-tête non pris en charge : on sert tout
 * le fichier), `null` si la plage est hors du fichier (416).
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange | null | undefined {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;

  // `bytes=-500` : les 500 derniers octets.
  const start = rawStart
    ? Number(rawStart)
    : Math.max(size - Number(rawEnd), 0);
  const end =
    rawStart && rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;

  return start <= end && start < size ? { start, end } : null;
}
