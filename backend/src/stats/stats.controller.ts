import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { Exam, ExamStatus, Patient, Role, User } from '../entities';

@Controller()
export class StatsController {
  constructor(
    @InjectRepository(Exam) private readonly exams: Repository<Exam>,
    @InjectRepository(Patient) private readonly patients: Repository<Patient>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ai: AiService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('ai/status')
  aiStatus() {
    return this.ai.etat();
  }

  @Post('ai/warmup')
  @Roles(Role.RADIOLOGUE)
  @HttpCode(202)
  aiWarmup() {
    void this.ai.prechauffer(); // on répond tout de suite : le préchauffage continue en arrière-plan
    return { ok: true };
  }

  @Get('stats')
  async stats(@CurrentUser() user: User) {
    const debutJour = new Date();
    debutJour.setHours(0, 0, 0, 0);
    // un médecin ne compte que les examens qu'il a prescrits
    const mien = user.role === Role.MEDECIN ? { demandePar: { id: user.id } } : {};
    const [patients, examensJour, aValider, enCours, echecs, valides, utilisateurs] = await Promise.all([
      user.role === Role.MEDECIN
        ? this.patients.createQueryBuilder('p')
          .where('EXISTS (SELECT 1 FROM examens x WHERE x."patientId" = p.id AND x."demandeParId" = :id)', { id: user.id }).getCount()
        : this.patients.count(),
      this.exams.count({ where: { ...mien, creeLe: MoreThanOrEqual(debutJour) } }),
      this.exams.count({ where: { ...mien, statut: ExamStatus.A_VALIDER } }),
      this.exams.count({ where: [{ ...mien, statut: ExamStatus.ANALYSE_EN_COURS }, { ...mien, statut: ExamStatus.EN_ATTENTE }] }),
      this.exams.count({ where: { ...mien, statut: ExamStatus.ECHEC } }),
      this.exams.count({ where: { ...mien, statut: ExamStatus.VALIDE } }),
      this.users.count({ where: { actif: true } }),
    ]);
    return { patients, examensJour, aValider, enCours, echecs, valides, utilisateurs };
  }
}
