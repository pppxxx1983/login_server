import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AuthService } from './auth.service';
import { AdminTokenGuard } from './admin-token.guard';
import { CurrentAdmin } from './current-admin.decorator';
import { randomUUID } from 'crypto';

const SESSION_DAYS = 7;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  @Post('login')
  async login(@Body() body: { username?: string; password?: string }) {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) throw new UnauthorizedException('username and password required');

    const [rows]: any = await this.db.pool.execute(
      'SELECT id, username, password_hash, role, is_active FROM admin_accounts WHERE username = ? LIMIT 1',
      [username],
    );
    const admin = rows[0];
    if (!admin || !admin.is_active) throw new UnauthorizedException('invalid username or password');

    const valid = await this.auth.verifyPassword(password, admin.password_hash);
    if (!valid) throw new UnauthorizedException('invalid username or password');

    const token = randomUUID();

    await this.db.pool.execute(
      'INSERT INTO admin_sessions (admin_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
      [admin.id, token, SESSION_DAYS],
    );

    return {
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role },
    };
  }

  @Post('logout')
  @UseGuards(AdminTokenGuard)
  async logout(@Req() req: any) {
    const authorization = String(req.headers.authorization || '');
    if (authorization.startsWith('Bearer ')) {
      const token = authorization.slice(7);
      await this.db.pool.execute('DELETE FROM admin_sessions WHERE token = ?', [token]);
    }
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminTokenGuard)
  me(@CurrentAdmin() admin: any) {
    return admin;
  }
}
