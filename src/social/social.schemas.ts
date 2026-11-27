import { z } from 'zod';
import {
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from './social.constants';

/** Validation des entrées de l'API sociale. */

/** Identifiant d'utilisateur ou de groupe. */
export const idSchema = z.string().min(1).max(64);

export const searchQuerySchema = z
  .string({ error: 'Indiquez un nom à rechercher' })
  .trim()
  .min(SEARCH_MIN_LENGTH, `Au moins ${SEARCH_MIN_LENGTH} caractères`)
  .max(SEARCH_MAX_LENGTH, 'Recherche trop longue');

/** Nom de groupe, espaces superflus retirés. */
const groupNameSchema = z
  .string({ error: 'Donnez un nom au groupe' })
  .trim()
  .transform((name) => name.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Donnez un nom au groupe')
      .max(GROUP_NAME_MAX_LENGTH, 'Nom de groupe trop long'),
  );

/** Amis à mettre dans un groupe. */
const memberIdsSchema = z
  .array(idSchema, { error: 'Choisissez au moins un ami' })
  .min(1, 'Choisissez au moins un ami')
  .max(GROUP_MAX_MEMBERS - 1, 'Trop de membres');

export const createGroupSchema = z.object({
  name: groupNameSchema,
  memberIds: memberIdsSchema,
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const renameGroupSchema = z.object({ name: groupNameSchema });

export type RenameGroupInput = z.infer<typeof renameGroupSchema>;

export const addGroupMembersSchema = z.object({ memberIds: memberIdsSchema });

export type AddGroupMembersInput = z.infer<typeof addGroupMembersSchema>;

/** Écrire, envoyer des vocaux, lancer un appel : chaque action, permise ou non. */
const permissionsSchema = z.object(
  {
    write: z.boolean(),
    voice: z.boolean(),
    call: z.boolean(),
  },
  { error: 'Autorisations invalides' },
);

export const groupPermissionsSchema = permissionsSchema;

export type GroupPermissionsInput = z.infer<typeof groupPermissionsSchema>;

/** Rôle d'un membre, ou ses restrictions personnelles (au moins l'un des deux). */
export const updateGroupMemberSchema = z
  .object({
    role: z.enum(['admin', 'member']).optional(),
    permissions: permissionsSchema.optional(),
  })
  .refine((input) => input.role !== undefined || input.permissions, {
    error: 'Rien à modifier',
  });

export type UpdateGroupMemberInput = z.infer<typeof updateGroupMemberSchema>;

/** Le propriétaire qui part désigne son successeur. */
export const leaveGroupSchema = z
  .object({ successorId: idSchema.optional() })
  // Requête sans corps : un simple membre n'a personne à désigner.
  .default({});

export type LeaveGroupInput = z.infer<typeof leaveGroupSchema>;
