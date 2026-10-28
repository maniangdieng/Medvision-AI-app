import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { Role, User } from '../entities';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Route accessible sans connexion. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Restreint la route à certains rôles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export type AuthRequest = Request & { user: User };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest<AuthRequest>().user,
);

export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
}
