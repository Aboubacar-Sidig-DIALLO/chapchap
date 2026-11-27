import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { auth } from './auth/auth';
import { setClientIp } from './auth/client-ip';
import { CallModule } from './call/call.module';
import { ChatModule } from './chat/chat.module';
import { DatabaseModule } from './database/database.module';
import { InvitesModule } from './invites/invites.module';
import { QuietModeModule } from './quiet-mode/quiet-mode.module';
import { SocialModule } from './social/social.module';
import { TalkieModule } from './talkie/talkie.module';

@Module({
  imports: [
    // Monte Better Auth sur `/api/auth/*` et protège par défaut toutes les
    // routes HTTP : une route publique se déclare avec `@AllowAnonymous()`.
    // `middleware` passe l'IP du client à Better Auth avant chaque requête.
    AuthModule.forRoot({ auth, middleware: setClientIp }),
    DatabaseModule,
    SocialModule,
    InvitesModule,
    QuietModeModule,
    ChatModule,
    CallModule,
    TalkieModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
