/**
 * Clés VAPID : elles prouvent aux services push des navigateurs que les
 * notifications viennent bien de ce serveur. À générer une fois pour toutes
 * (`npx web-push generate-vapid-keys`) et à garder : en changer désabonne
 * tous les navigateurs.
 *
 * Sans elles, les notifications push sont simplement désactivées.
 */
export const VAPID = {
  publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  /** Contact de l'expéditeur (`mailto:` ou `https:`), exigé par Apple. */
  subject: process.env.VAPID_SUBJECT ?? 'mailto:notifications@localhost',
};

/**
 * Seuls les services push des navigateurs sont joignables : un abonnement
 * vers une autre adresse (réseau interne…) est refusé.
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Opera, Samsung Internet
  'push.services.mozilla.com', // Firefox
  'notify.windows.com', // Edge (ancien service Windows)
  'push.apple.com', // Safari, iOS
];

/**
 * Pages du front ouvertes au toucher d'une notification — à garder
 * synchronisé avec `ROUTES` (`chat-nextjs/src/features/auth/lib/routes.ts`).
 */
export const FRONT_ROUTES = {
  home: '/',
  friend: (userId: string) => `/amis/${encodeURIComponent(userId)}`,
  group: (groupId: string) => `/groupes/${encodeURIComponent(groupId)}`,
  joinCall: (href: string) => `${href}?rejoindre=appel`,
};

/** Durée de vie d'une sonnerie : au-delà, inutile d'annoncer l'appel. */
export const CALL_PUSH_TTL_S = 30;
/** Un message disparaît au bout d'une heure : sa notification aussi. */
export const MESSAGE_PUSH_TTL_S = 60 * 60;
/** Demande d'ami, ajout à un groupe. */
export const SOCIAL_PUSH_TTL_S = 24 * 60 * 60;
