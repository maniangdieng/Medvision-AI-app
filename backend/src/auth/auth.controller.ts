import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { CookieOptions, Request, Response } from 'express';
import { ACCESS_COOKIE } from '../common/auth.guard';
import { clientIp, CurrentUser, Public } from '../common/decorators';
import { User } from '../entities';
import { AuthService, Tokens } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto';

const REFRESH_COOKIE = 'mv_rt';

@Controller('auth')
export class AuthController {
  private readonly secure: boolean;
  constructor(private readonly auth: AuthService, config: ConfigService) {
    this.secure = config.get('COOKIE_SECURE', 'false') === 'true';
  }

  private base(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict' };
  }

  private poserCookies(res: Response, t: Tokens) {
    res.cookie(ACCESS_COOKIE, t.accessToken, { ...this.base(), path: '/', maxAge: 15 * 60_000 });
    res.cookie(REFRESH_COOKIE, t.refreshToken, { ...this.base(), path: '/api/auth', maxAge: 7 * 86_400_000 });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(dto.email, dto.motDePasse, clientIp(req), req.get('user-agent') || '');
    this.poserCookies(res, t);
    return t.user;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientIp(req), req.get('user-agent') || '');
    this.poserCookies(res, t);
    return t.user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], clientIp(req));
    res.clearCookie(ACCESS_COOKIE, { ...this.base(), path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...this.base(), path: '/api/auth' });
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return user;
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.changerMotDePasse(user, dto.ancienMotDePasse, dto.nouveauMotDePasse, clientIp(req));
    // nouvelle session propre après le changement
    this.poserCookies(res, await this.auth.emettre(user, clientIp(req), req.get('user-agent') || ''));
  }
}
