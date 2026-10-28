import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, User } from '../entities';

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async log(
    action: string,
    opts: { user?: Pick<User, 'id' | 'email'> | null; email?: string; entite?: string; entiteId?: string; details?: string; ip?: string } = {},
  ): Promise<void> {
    try {
      await this.repo.insert({
        action,
        utilisateurId: opts.user?.id,
        utilisateurEmail: opts.user?.email ?? opts.email,
        entite: opts.entite,
        entiteId: opts.entiteId,
        details: opts.details?.slice(0, 1000),
        ip: opts.ip,
      });
    } catch (e) {
      // l'audit ne doit jamais faire échouer l'action métier
      this.logger.error(`Échec écriture audit ${action}: ${(e as Error).message}`);
    }
  }

  liste(page = 1, taille = 50, action?: string) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.date', 'DESC')
      .skip((page - 1) * taille).take(Math.min(taille, 200));
    if (action) qb.where('a.action = :action', { action });
    return qb.getManyAndCount().then(([items, total]) => ({ items, total, page }));
  }
}
