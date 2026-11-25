import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CallGateway } from './call.gateway';
import { CallService } from './call.service';

@Module({
  // La trace d'un direct terminé est déposée dans la conversation.
  imports: [ChatModule],
  providers: [CallGateway, CallService],
})
export class CallModule {}
