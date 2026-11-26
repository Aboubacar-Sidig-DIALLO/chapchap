import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type ListUsersQuery, listUsersQuerySchema } from './admin.schemas';
import { AdminService } from './admin.service';
import type { AdminStats, AdminUserPage } from './admin.types';

/**
 * Lecture pour l'administration, réservée aux comptes de rôle `admin`.
 *
 * Les actions sur les comptes (création, modification, rôle, suspension,
 * sessions, connexion « en tant que », suppression) passent par le plugin
 * Admin de Better Auth (`/api/auth/admin/*`), qui vérifie lui aussi le rôle.
 */
@Controller('admin')
@Roles(['admin'])
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** `GET /admin/stats` : vue d'ensemble des comptes. */
  @Get('stats')
  stats(): Promise<AdminStats> {
    return this.adminService.stats();
  }

  /**
   * `GET /admin/users?search=&filter=&sort=&page=` : les comptes, recherchés
   * dans le nom et l'adresse sans tenir compte de la casse (ce que la liste
   * du plugin ne permet pas), avec leur présence.
   */
  @Get('users')
  listUsers(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<AdminUserPage> {
    return this.adminService.listUsers(query);
  }
}
