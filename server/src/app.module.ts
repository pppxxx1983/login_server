import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';
import { PlayersController } from './players.controller';
import { RankingsController } from './rankings.controller';
import { AuthController } from './auth.controller';
import { AdminAccountsController } from './admin-accounts.controller';
import { AuthService } from './auth.service';
import { TrackingController } from './tracking.controller';

@Module({
  controllers: [
    PlayersController,
    RankingsController,
    AuthController,
    AdminAccountsController,
    TrackingController,
  ],
  providers: [DatabaseService, AdminTokenGuard, AuthService],
})
export class AppModule {}
