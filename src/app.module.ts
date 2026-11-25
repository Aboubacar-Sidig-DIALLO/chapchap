import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CallModule } from './call/call.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [ChatModule, CallModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
