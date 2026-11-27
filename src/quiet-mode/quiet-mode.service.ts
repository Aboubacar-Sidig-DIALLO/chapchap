import { Injectable, Logger } from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import type { PrismaClient, QuietMode } from '../generated/prisma/client';
import {
  DEFAULT_QUIET_SETTINGS,
  isQuietAt,
  type QuietSettings,
} from './quiet-mode.rules';
import type {
  QuietManualInput,
  QuietScheduleInput,
} from './quiet-mode.schemas';
import type { QuietModeState } from './quiet-mode.types';

function toSettings(row: QuietMode | null): QuietSettings {
  return row ?? DEFAULT_QUIET_SETTINGS;
}

function toState(settings: QuietSettings): QuietModeState {
  return {
    schedule: {
      enabled: settings.scheduleEnabled,
      startMinute: settings.startMinute,
      endMinute: settings.endMinute,
      timeZone: settings.timeZone,
    },
    manual: {
      on: settings.manualOn,
      until: settings.manualUntil?.toISOString() ?? null,
    },
  };
}

/**
 * Heures calmes / Ne pas déranger : quand un utilisateur ne veut pas être
 * dérangé. Le reste de l'application le consulte : les notifications push
 * arrivent alors sans bruit, et le talkie-walkie ne le joint plus en direct
 * (il reçoit le vocal, à écouter plus tard).
 */
@Injectable()
export class QuietModeService {
  private readonly logger = new Logger(QuietModeService.name);

  constructor(@InjectPrisma() private readonly prisma: PrismaClient) {}

  async get(userId: string): Promise<QuietModeState> {
    const row = await this.prisma.quietMode.findUnique({ where: { userId } });
    return toState(toSettings(row));
  }

  async setSchedule(
    userId: string,
    schedule: QuietScheduleInput,
  ): Promise<QuietModeState> {
    const data = {
      scheduleEnabled: schedule.enabled,
      startMinute: schedule.startMinute,
      endMinute: schedule.endMinute,
      timeZone: schedule.timeZone,
    };
    const row = await this.prisma.quietMode.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toState(row);
  }

  async setManual(
    userId: string,
    { on, until }: QuietManualInput,
  ): Promise<QuietModeState> {
    const data = {
      manualOn: on,
      manualUntil: on && until ? new Date(until) : null,
    };
    const row = await this.prisma.quietMode.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toState(row);
  }

  /**
   * Parmi ces utilisateurs, ceux qui ne veulent pas être dérangés en ce
   * moment. En cas de panne, personne : mieux vaut un son de trop qu'un
   * message qui n'arrive pas.
   */
  async quietUserIds(userIds: string[], now = new Date()): Promise<string[]> {
    if (userIds.length === 0) return [];
    try {
      const rows = await this.prisma.quietMode.findMany({
        where: {
          userId: { in: [...new Set(userIds)] },
          OR: [{ scheduleEnabled: true }, { manualOn: true }],
        },
      });
      return rows.filter((row) => isQuietAt(row, now)).map((row) => row.userId);
    } catch (error) {
      this.logger.warn(`Heures calmes illisibles : ${String(error)}`);
      return [];
    }
  }

  async isQuiet(userId: string): Promise<boolean> {
    return (await this.quietUserIds([userId])).length > 0;
  }
}
