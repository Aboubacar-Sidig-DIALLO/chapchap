import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  sessionMiddleware,
} from 'better-auth/api';
import { deleteSessionCookie, setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { accountEvents } from './account-events';
import { findAccountLinks } from './account-links';
import { AUTH_ERROR, AUTH_RATE_LIMIT_PER_MINUTE } from './auth.constants';

const SIGN_UP_PATH = '/sign-up/email-only';
const SIGN_IN_PATH = '/sign-in/email-only';
const CHANGE_EMAIL_PATH = '/change-email/email-only';
const DELETE_ACCOUNT_PATH = '/delete-account/email-only';

/** Routes freinées : chacune peut servir à tester des adresses en série. */
const RATE_LIMITED_PATHS = new Set([
  SIGN_UP_PATH,
  SIGN_IN_PATH,
  CHANGE_EMAIL_PATH,
  DELETE_ACCOUNT_PATH,
]);

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
 * Ferme toutes les sessions de l'utilisateur, sur tous ses appareils, et
 * efface le cookie de celle-ci. Ses connexions temps réel se ferment aussi.
 */
async function signOutEverywhere(ctx: GenericEndpointContext, userId: string) {
  await ctx.context.internalAdapter.deleteUserSessions(userId);
  deleteSessionCookie(ctx);
  accountEvents.signedOutEverywhere$.next({ userId });
}

/**
 * Plugin Better Auth : inscription et connexion par simple adresse email,
 * sans mot de passe ni vérification ; changement d'adresse et suppression du
 * compte dans la même logique.
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

      /**
       * Remplace l'adresse du compte, puis ferme toutes ses sessions : on se
       * reconnecte avec la nouvelle adresse, sur chaque appareil.
       *
       * La route `/change-email` de Better Auth n'est pas utilisée : pour ne pas
       * révéler les adresses existantes, elle répond « succès » sans rien faire
       * quand l'adresse est prise. Ici, se reconnecter avec cette adresse
       * ouvrirait le compte de quelqu'un d'autre : l'erreur doit être dite.
       */
      changeEmailEmailOnly: createAuthEndpoint(
        CHANGE_EMAIL_PATH,
        {
          method: 'POST',
          use: [formCsrfMiddleware, sessionMiddleware],
          body: z.object({ newEmail: z.string() }),
        },
        async (ctx) => {
          const { user } = ctx.context.session;
          const newEmail = parseEmail(ctx.body.newEmail);
          const { internalAdapter } = ctx.context;

          if (newEmail === user.email) {
            throw new APIError('BAD_REQUEST', {
              code: AUTH_ERROR.EMAIL_UNCHANGED,
              message: "C'est déjà l'adresse de votre compte",
            });
          }
          if (await internalAdapter.findUserByEmail(newEmail)) {
            throw new APIError('BAD_REQUEST', {
              code: AUTH_ERROR.ACCOUNT_EXISTS,
              message: 'Un compte existe déjà avec cette adresse',
            });
          }

          await internalAdapter.updateUser(user.id, { email: newEmail });
          await signOutEverywhere(ctx, user.id);

          return ctx.json({ email: newEmail });
        },
      ),

      /**
       * Supprime le compte et tout ce qui s'y rattache (sessions, amis,
       * groupes), après confirmation par son adresse email : c'est elle qui
       * ouvre le compte, elle tient lieu de mot de passe.
       *
       * Remplace `/delete-user` de Better Auth, qui exige une session ouverte
       * depuis moins d'un jour (sans mot de passe à redemander) : une contrainte
       * qui, ici, ne protégerait de rien et bloquerait les sessions plus anciennes.
       */
      deleteAccountEmailOnly: createAuthEndpoint(
        DELETE_ACCOUNT_PATH,
        {
          method: 'POST',
          use: [formCsrfMiddleware, sessionMiddleware],
          body: z.object({ email: z.string() }),
        },
        async (ctx) => {
          const { user } = ctx.context.session;
          if (parseEmail(ctx.body.email) !== user.email) {
            throw new APIError('BAD_REQUEST', {
              code: AUTH_ERROR.EMAIL_MISMATCH,
              message: "Ce n'est pas l'adresse de votre compte",
            });
          }

          // Lu avant la suppression, qui efface ces liens en cascade.
          const links = await findAccountLinks(user.id);
          await ctx.context.internalAdapter.deleteUser(user.id);
          await signOutEverywhere(ctx, user.id);
          accountEvents.deleted$.next({ userId: user.id, ...links });

          return ctx.json({ success: true });
        },
      ),
    },

    // Freine les essais d'adresses en série (actif quand `rateLimit` l'est).
    rateLimit: [
      {
        pathMatcher: (path) => RATE_LIMITED_PATHS.has(path),
        window: 60,
        max: AUTH_RATE_LIMIT_PER_MINUTE,
      },
    ],
  }) satisfies BetterAuthPlugin;
