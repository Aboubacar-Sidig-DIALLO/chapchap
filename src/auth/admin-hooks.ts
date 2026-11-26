import type { GenericEndpointContext } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from 'better-auth/api';
import { accountEvents } from './account-events';
import { AUTH_ERROR } from './auth.constants';
import { ADMIN_ROLE, isAdmin } from './roles';

/**
 * Règles d'accès ajoutées au plugin Admin de Better Auth.
 *
 * Mots de passe : seuls les administrateurs en ont un, et se connectent avec ;
 * les autres comptes se connectent par email seul (`email-only.plugin.ts`).
 */

interface AdminBody {
  userId?: unknown;
  email?: unknown;
  role?: unknown;
  password?: unknown;
}

function bodyOf(ctx: { body?: unknown }): AdminBody {
  return ctx.body ?? {};
}

/** Rôle demandé (`role` peut être une liste) : `true` s'il fait un administrateur. */
function grantsAdmin(role: unknown): boolean {
  const roles: unknown[] = Array.isArray(role) ? role : [role];
  return roles.includes(ADMIN_ROLE);
}

async function hasPassword(ctx: GenericEndpointContext, userId: string) {
  return (
    (await ctx.context.internalAdapter.findCredentialAccount(userId)) !== null
  );
}

/** Ferme toutes les sessions d'un compte, connexions temps réel comprises. */
async function endSessions(ctx: GenericEndpointContext, userId: string) {
  await ctx.context.internalAdapter.deleteUserSessions(userId);
  accountEvents.signedOutEverywhere$.next({ userId });
}

function reject(code: string, message: string): never {
  throw new APIError('BAD_REQUEST', { code, message });
}

export const adminBeforeHook = createAuthMiddleware(async (ctx) => {
  const body = bodyOf(ctx);

  switch (ctx.path) {
    // Connexion par mot de passe : administrateurs uniquement. Même réponse
    // qu'un mot de passe faux, pour ne rien révéler des autres comptes.
    case '/sign-in/email': {
      const email = typeof body.email === 'string' ? body.email : '';
      const found = email
        ? await ctx.context.internalAdapter.findUserByEmail(email)
        : null;
      if (found && !isAdmin(found.user)) {
        throw new APIError('UNAUTHORIZED', {
          code: AUTH_ERROR.INVALID_EMAIL_OR_PASSWORD,
          message: 'Adresse ou mot de passe incorrect',
        });
      }
      return;
    }

    // Un administrateur est créé avec son mot de passe ; un utilisateur, sans.
    case '/admin/create-user': {
      const hasPasswordInput =
        typeof body.password === 'string' && body.password !== '';
      if (grantsAdmin(body.role) && !hasPasswordInput) {
        reject(
          AUTH_ERROR.ADMIN_PASSWORD_REQUIRED,
          'Un administrateur doit avoir un mot de passe',
        );
      }
      if (!grantsAdmin(body.role) && hasPasswordInput) {
        reject(
          AUTH_ERROR.PASSWORD_ADMIN_ONLY,
          'Seuls les administrateurs ont un mot de passe',
        );
      }
      return;
    }

    case '/admin/set-role': {
      const userId = typeof body.userId === 'string' ? body.userId : null;
      if (!userId) return;
      // Il se retirerait l'accès à l'administration.
      const session = await getSessionFromCtx(ctx);
      if (session?.user.id === userId) {
        reject(
          AUTH_ERROR.CANNOT_CHANGE_OWN_ROLE,
          'Vous ne pouvez pas changer votre propre rôle',
        );
      }
      if (grantsAdmin(body.role) && !(await hasPassword(ctx, userId))) {
        reject(
          AUTH_ERROR.ADMIN_PASSWORD_REQUIRED,
          "Définissez d'abord le mot de passe de ce compte",
        );
      }
      return;
    }
  }
});

export const adminAfterHook = createAuthMiddleware(async (ctx) => {
  if (isAPIError(ctx.context.returned)) return;
  const body = bodyOf(ctx);
  const userId = typeof body.userId === 'string' ? body.userId : null;
  if (!userId) return;

  switch (ctx.path) {
    // Le plugin ne supprime que les sessions en base : on coupe aussi le temps réel.
    case '/admin/ban-user':
    case '/admin/revoke-user-sessions':
      accountEvents.signedOutEverywhere$.next({ userId });
      return;

    case '/admin/set-role': {
      if (grantsAdmin(body.role)) {
        // Nouvel administrateur : ses sessions ouvertes sans mot de passe se
        // ferment ; il se reconnecte avec le sien.
        await endSessions(ctx, userId);
        return;
      }
      // Plus administrateur : son mot de passe disparaît, il se connectera par email seul.
      const credential =
        await ctx.context.internalAdapter.findCredentialAccount(userId);
      if (credential)
        await ctx.context.internalAdapter.deleteAccount(credential.id);
      return;
    }
  }
});
