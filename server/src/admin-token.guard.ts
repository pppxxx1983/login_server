import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expected = process.env.ADMIN_TOKEN;
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization || '';

    if (expected && authorization === `Bearer ${expected}`) {
      return true;
    }

    if (!authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing token');
    }

    const token = authorization.slice(7);
    const [rows]: any = await this.db.pool.execute(
      `SELECT a.id, a.username, a.role, a.is_active
       FROM admin_sessions s
       JOIN admin_accounts a ON a.id = s.admin_id
       WHERE s.token = ? AND s.expires_at > NOW() AND a.is_active = 1
       LIMIT 1`,
      [token],
    );

    if (!rows[0]) {
      throw new UnauthorizedException('invalid or expired token');
    }

    request.admin = rows[0];
    return true;
  }
}
