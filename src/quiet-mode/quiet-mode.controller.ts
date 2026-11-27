import { Body, Controller, Get, Put } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  type QuietManualInput,
  quietManualSchema,
  type QuietScheduleInput,
  quietScheduleSchema,
} from './quiet-mode.schemas';
import { QuietModeService } from './quiet-mode.service';
import type { QuietModeState } from './quiet-mode.types';

/** Ses propres heures calmes (routes réservées aux utilisateurs connectés). */
@Controller('quiet-mode')
export class QuietModeController {
  constructor(private readonly quietMode: QuietModeService) {}

  /** `GET /quiet-mode` : ses réglages. */
  @Get()
  get(@Session() session: UserSession): Promise<QuietModeState> {
    return this.quietMode.get(session.user.id);
  }

  /** `PUT /quiet-mode/schedule` : heures calmes chaque jour. */
  @Put('schedule')
  setSchedule(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(quietScheduleSchema)) body: QuietScheduleInput,
  ): Promise<QuietModeState> {
    return this.quietMode.setSchedule(session.user.id, body);
  }

  /** `PUT /quiet-mode/manual` : « ne pas déranger » maintenant (jusqu'à une heure, ou sans fin), ou plus. */
  @Put('manual')
  setManual(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(quietManualSchema)) body: QuietManualInput,
  ): Promise<QuietModeState> {
    return this.quietMode.setManual(session.user.id, body);
  }
}
