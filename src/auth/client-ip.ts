import type { Request } from 'express';

/**
 * En-tête où le serveur dépose l'IP du client, pour Better Auth (limitation
 * du nombre de tentatives, IP associée à la session).
 *
 * Better Auth ne voit qu'une requête Web, sans accès à la connexion TCP : il
 * lit l'IP dans un en-tête. Celui-ci est toujours réécrit par le serveur, donc
 * un client ne peut pas se faire passer pour une autre adresse.
 */
export const CLIENT_IP_HEADER = 'x-client-ip';

/**
 * Middleware accepté par `AuthModule.forRoot({ middleware })`, que la
 * bibliothèque n'exporte pas. Il doit garder exactement ce type (`req: any`) :
 * avec un type Express plus précis, TypeScript retient l'ancienne signature
 * dépréciée `forRoot(auth, options)` au lieu de `forRoot({ auth, ... })`.
 */
type AuthModuleMiddleware = (req: any, res: unknown, next: () => void) => void;

/**
 * Remplace l'en-tête par l'IP vue par Express (`req.ip`) : l'adresse de la
 * connexion, ou celle transmise par un proxy si `trust proxy` est configuré.
 */
export const setClientIp: AuthModuleMiddleware = (req: Request, _res, next) => {
  if (req.ip) {
    req.headers[CLIENT_IP_HEADER] = req.ip;
  } else {
    delete req.headers[CLIENT_IP_HEADER];
  }
  next();
};
