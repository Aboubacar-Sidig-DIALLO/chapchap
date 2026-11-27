import { Module } from '@nestjs/common';
import { QuietModeController } from './quiet-mode.controller';
import { QuietModeService } from './quiet-mode.service';

/** Heures calmes / Ne pas déranger : consultées par les notifications push et le talkie-walkie. */
@Module({
  controllers: [QuietModeController],
  providers: [QuietModeService],
  exports: [QuietModeService],
})
export class QuietModeModule {}
