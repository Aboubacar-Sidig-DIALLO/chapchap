/** Métadonnées d'un message vocal, mesurées par le client pendant l'enregistrement. */
export interface VoiceMetadata {
  durationMs: number;
  /** Amplitudes de 0 à 100, une par barre affichée. */
  waveform: number[];
}

/**
 * Métadonnées d'une image, mesurées par le client avant l'envoi : de quoi
 * réserver sa place exacte et afficher sa couleur avant qu'elle ne charge.
 */
export interface ImageMetadata {
  width: number;
  height: number;
  /** Couleur dominante, `#rrggbb`. */
  color: string;
}

/** Pièce jointe telle qu'exposée au client. */
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  /** Taille en octets. */
  size: number;
  /** Chemin relatif à l'API, ex. `/attachments/<id>`. */
  url: string;
  /** Présent pour un message vocal. */
  voice?: VoiceMetadata;
  /** Présent pour une image affichable. */
  image?: ImageMetadata;
}
