import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, User } from '../entities';
import { AuthRequest, IS_PUBLIC, ROLES } from './decorators';

export const ACCESS_COOKIE = 'mv_at';

/**
 * Garde global : toute route est protégée par défaut.
 * - lit le jeton d'accès dans un cookie httpOnly (inaccessible au JavaScript)
 * - recharge l'utilisateur à chaque requête : un compte désactivé perd l'accès immédiatement
 * - bloque tout sauf le changement de mot de passe tant que celui-ci est obligatoire
 * - applique les rôles déclarés par @Roles()
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('Session expirée');

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expirée');
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.actif) throw new UnauthorizedException('Compte inactif');
    req.user = user;

    const path = req.path || '';
    if (user.doitChangerMotDePasse && !path.endsWith('/auth/change-password') && !path.endsWith('/auth/me') && !path.endsWith('/auth/logout')) {
      throw new ForbiddenException('Changement de mot de passe obligatoire');
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Accès non autorisé pour votre rôle');
    }
    return true;
  }
}
