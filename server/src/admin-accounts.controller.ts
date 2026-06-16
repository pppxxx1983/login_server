import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AuthService } from './auth.service';
import { AdminTokenGuard } from './admin-token.guard';
import { CurrentAdmin } from './current-admin.decorator';

@Controller('admins')
@UseGuards(AdminTokenGuard)
export class AdminAccountsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list() {
    const [rows] = await this.db.pool.execute(
      `SELECT id, username, role, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM admin_accounts ORDER BY id ASC`,
    );
    return { items: rows };
  }

  @Post()
  async create(@Body() body: { username?: string; password?: string; role?: string }) {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = String(body.role || 'admin').trim();
    if (!username || !password) throw new NotFoundException('username and password required');

    const passwordHash = await this.auth.hashPassword(password);
    try {
      const [result]: any = await this.db.pool.execute(
        'INSERT INTO admin_accounts (username, password_hash, role) VALUES (?, ?, ?)',
        [username, passwordHash, role || 'admin'],
      );
      return { id: result.insertId, username, role: role || 'admin' };
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') throw new NotFoundException('username already exists');
      throw err;
    }
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password?: string; role?: string; isActive?: boolean },
  ) {
    const [rows]: any = await this.db.pool.execute(
      'SELECT id FROM admin_accounts WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('account not found');

    const updates: string[] = [];
    const params: any[] = [];

    if (body.password !== undefined && body.password !== '') {
      updates.push('password_hash = ?');
      params.push(await this.auth.hashPassword(body.password));
    }
    if (body.role !== undefined) {
      updates.push('role = ?');
      params.push(String(body.role).trim() || 'admin');
    }
    if (body.isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(body.isActive ? 1 : 0);
    }

    if (!updates.length) return { id };

    await this.db.pool.execute(
      `UPDATE admin_accounts SET ${updates.join(', ')} WHERE id = ?`,
      [...params, id],
    );

    return { id };
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentAdmin() admin: any) {
    const [rows]: any = await this.db.pool.execute(
      'SELECT id FROM admin_accounts WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('account not found');
    if (id === admin.id) throw new NotFoundException('cannot delete yourself');

    await this.db.pool.execute('DELETE FROM admin_accounts WHERE id = ?', [id]);
    return { id };
  }
}
