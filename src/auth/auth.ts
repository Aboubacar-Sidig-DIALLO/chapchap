import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { CLIENT_ORIGIN } from '../config';
import { prisma } from '../database/prisma';
import {
  AUTH_ERROR,
  MAX_NAME_LENGTH,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from './auth.constants';
import { CLIENT_IP_HEADER } from './client-ip';
import { accountEvents } from './account-events';
import { emailOnly } from './email-only.plugin';

/** Nom affiché : espaces superflus retirés, ni vide ni trop long. */
function normalizeName(name: unknown): string {
  const normalized =
    typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';

  if (!normalized) {
    throw new APIError('BAD_REQUEST', {
      code: AUTH_ERROR.NAME_REQUIRED,
      message: 'Un nom ou un pseudo est requis',
    });
  }
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new APIError('BAD_REQUEST', {
      code: AUTH_ERROR.NAME_TOO_LONG,
      message: `Le nom ne doit pas dépasser ${MAX_NAME_LENGTH} caractères`,
    });
  }
  return normalized;
}

/**
 * Authentification par simple adresse email, sans mot de passe :
 * - inscription : nom (ou pseudo) + email → compte créé, session ouverte ;
 * - connexion : email d'un compte existant → session ouverte.
 *
 * Les deux routes viennent du plugin `emailOnly` (`./email-only.plugin.ts`).
 *
 * Variables d'environnement lues par Better Auth : `BETTER_AUTH_SECRET`
 * (signature des cookies) et `BETTER_AUTH_URL` (URL publique de cette API).
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  // Seul le front a le droit d'appeler l'API d'authentification (protection CSRF).
  trustedOrigins: [CLIENT_ORIGIN],

  // Actif aussi en développement (par défaut : production seulement).
  rateLimit: { enabled: true },

  // IP du client déposée par le serveur lui-même (`./client-ip.ts`), jamais
  // un en-tête fourni par le navigateur.
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },

  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    // Pas de cache de session dans un cookie : chaque requête relit la session
    // en base, si bien qu'une session fermée (changement d'email, suppression
    // du compte) l'est aussitôt sur tous les appareils, pas 5 minutes plus tard.
    cookieCache: { enabled: false },
  },

  databaseHooks: {
    user: {
      create: {
        before: (user) =>
          Promise.resolve({
            data: { ...user, name: normalizeName(user.name) },
          }),
      },
      update: {
        before: (user) =>
          Promise.resolve(
            user.name === undefined
              ? { data: user }
              : { data: { ...user, name: normalizeName(user.name) } },
          ),
        // Nom ou adresse modifiés : les listes de ses amis se mettent à jour en direct.
        after: (user) => {
          accountEvents.updated$.next({ userId: user.id });
          return Promise.resolve();
        },
      },
    },
  },

  plugins: [emailOnly()],
});

export type Auth = typeof auth;
