import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { Public, Roles } from '../common/decorators';
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
  @Roles(Role.MEDECIN, Role.RADIOLOGUE)
  @HttpCode(202)
  aiWarmup() {
    void this.ai.prechauffer(); // on répond tout de suite : le préchauffage continue en arrière-plan
    return { ok: true };
  }

  @Get('stats')
  async stats() {
    const debutJour = new Date();
    debutJour.setHours(0, 0, 0, 0);
    const [patients, examensJour, aValider, enCours, echecs, valides, utilisateurs] = await Promise.all([
      this.patients.count(),
      this.exams.count({ where: { creeLe: MoreThanOrEqual(debutJour) } }),
      this.exams.count({ where: { statut: ExamStatus.A_VALIDER } }),
      this.exams.count({ where: [{ statut: ExamStatus.ANALYSE_EN_COURS }, { statut: ExamStatus.EN_ATTENTE }] }),
      this.exams.count({ where: { statut: ExamStatus.ECHEC } }),
      this.exams.count({ where: { statut: ExamStatus.VALIDE } }),
      this.users.count({ where: { actif: true } }),
    ]);
    return { patients, examensJour, aValider, enCours, echecs, valides, utilisateurs };
  }
}
