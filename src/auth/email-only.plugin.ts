import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { AUTH_ERROR, AUTH_RATE_LIMIT_PER_MINUTE } from './auth.constants';

const SIGN_UP_PATH = '/sign-up/email-only';
const SIGN_IN_PATH = '/sign-in/email-only';

/** Adresse sans espaces superflus, en minuscules, et de forme valide. */
function parseEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new APIError('BAD_REQUEST', {
      code: AUTH_ERROR.INVALID_EMAIL,
      message: 'Adresse email invalide',
    });
  }
  return email;
}

/**
 * Plugin Better Auth : inscription et connexion par simple adresse email,
 * sans mot de passe ni vérification.
 *
 * ⚠️ Connaître l'email d'un compte suffit pour s'y connecter. Ce choix
 * privilégie la simplicité ; pour vérifier la possession de l'adresse,
 * remplacer ce plugin par `emailOTP` ou `magicLink` de Better Auth.
 *
 * Les comptes, sessions et cookies restent entièrement gérés par Better Auth
 * (hooks, durée de session, cookie httpOnly, protection CSRF, limitation de débit).
 */
export const emailOnly = () =>
  ({
    id: 'email-only',
    endpoints: {
      /** Crée le compte puis ouvre directement une session. */
      signUpEmailOnly: createAuthEndpoint(
        SIGN_UP_PATH,
        {
          method: 'POST',
          use: [formCsrfMiddleware],
          body: z.object({ name: z.string(), email: z.string() }),
        },
        async (ctx) => {
          const email = parseEmail(ctx.body.email);
          const { internalAdapter } = ctx.context;

          if (await internalAdapter.findUserByEmail(email)) {
            throw new APIError('BAD_REQUEST', {
              code: AUTH_ERROR.ACCOUNT_EXISTS,
              message: 'Un compte existe déjà avec cette adresse',
            });
          }

          // Le nom est validé et nettoyé par `databaseHooks.user.create` (auth.ts).
          const user = await internalAdapter.createUser(
            { email, name: ctx.body.name, emailVerified: false },
            { method: 'email-only' },
          );
          const session = await internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });

          return ctx.json({ user: { id: user.id, name: user.name, email } });
        },
      ),

      /** Ouvre une session sur le compte associé à cette adresse. */
      signInEmailOnly: createAuthEndpoint(
        SIGN_IN_PATH,
        {
          method: 'POST',
          use: [formCsrfMiddleware],
          body: z.object({ email: z.string() }),
        },
        async (ctx) => {
          const email = parseEmail(ctx.body.email);
          const { internalAdapter } = ctx.context;

          const found = await internalAdapter.findUserByEmail(email);
          if (!found) {
            throw new APIError('BAD_REQUEST', {
              code: AUTH_ERROR.ACCOUNT_NOT_FOUND,
              message: 'Aucun compte avec cette adresse',
            });
          }

          const { user } = found;
          const session = await internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });

          return ctx.json({ user: { id: user.id, name: user.name, email } });
        },
      ),
    },

    // Freine les essais d'adresses en série (actif quand `rateLimit` l'est).
    rateLimit: [
      {
        pathMatcher: (path) => path === SIGN_UP_PATH || path === SIGN_IN_PATH,
        window: 60,
        max: AUTH_RATE_LIMIT_PER_MINUTE,
      },
    ],
  }) satisfies BetterAuthPlugin;
