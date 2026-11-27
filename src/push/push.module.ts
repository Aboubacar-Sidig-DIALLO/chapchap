import { Module } from '@nestjs/common';
import { QuietModeModule } from '../quiet-mode/quiet-mode.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/** Notifications push (PWA) : abonnements des navigateurs et envoi (sans bruit pendant les heures calmes). */
@Module({
  imports: [QuietModeModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
