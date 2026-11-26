import { z } from 'zod';

export const ADMIN_PAGE_SIZE = 20;

/** Paramètres de `GET /admin/users`. */
export const listUsersQuerySchema = z.object({
  /** Cherché dans le nom et l'adresse, sans tenir compte de la casse. */
  search: z.string().trim().max(100).optional().default(''),
  filter: z
    .enum(['all', 'online', 'admins', 'banned'])
    .optional()
    .default('all'),
  sort: z.enum(['newest', 'oldest', 'name']).optional().default('newest'),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
