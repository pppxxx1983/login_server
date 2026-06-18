import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';
import { PlayersController } from './players.controller';
import { RankingsController } from './rankings.controller';
import { AuthController } from './auth.controller';
import { AdminAccountsController } from './admin-accounts.controller';
import { StatsController } from './stats.controller';
import { DailyStatsController } from './daily-stats.controller';
import { OnlineStatsController } from './online-stats.controller';
import { OnlineDurationController } from './online-duration.controller';
import { AuthService } from './auth.service';
import { TrackingController } from './tracking.controller';

@Module({
  controllers: [
    PlayersController,
    RankingsController,
    AuthController,
    AdminAccountsController,
    TrackingController,
    StatsController,
    DailyStatsController,
    OnlineStatsController,
    OnlineDurationController,
  ],
  providers: [DatabaseService, AdminTokenGuard, AuthService],
})
export class AppModule {}
