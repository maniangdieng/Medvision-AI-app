import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsDateString, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { Brackets, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { clientIp, CurrentUser, Roles } from '../common/decorators';
import { ExamStatus, Patient, Role, Sexe, User } from '../entities';

class CreatePatientDto {
  @IsString() @MinLength(1) @MaxLength(80) prenom!: string;
  @IsString() @MinLength(1) @MaxLength(80) nom!: string;
  @IsOptional() @IsDateString({}, { message: 'Date de naissance invalide' }) dateNaissance?: string;
  @IsOptional() @IsEnum(Sexe) sexe?: Sexe;
  @IsOptional() @Matches(/^[+0-9 ]{6,20}$/, { message: 'Téléphone invalide' }) telephone?: string;
  @IsOptional() @IsString() @MaxLength(200) adresse?: string;
}

@Controller('patients')
@Roles(Role.MEDECIN, Role.RADIOLOGUE)
export class PatientsController {
  constructor(@InjectRepository(Patient) private readonly patients: Repository<Patient>, private readonly audit: AuditService) {}

  @Get()
  async liste(@Query('q') q = '', @Query('page') page = '1') {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const qb = this.patients.createQueryBuilder('p')
      .loadRelationCountAndMap('p.nbExamens', 'p.examens')
      .orderBy('p.creeLe', 'DESC').skip((p - 1) * 20).take(20);
    const terme = q.trim();
    if (terme) {
      qb.where(new Brackets((w) => {
        w.where('p.nom ILIKE :t', { t: `%${terme}%` })
          .orWhere('p.prenom ILIKE :t', { t: `%${terme}%` })
          .orWhere('p.numeroDossier ILIKE :t', { t: `%${terme}%` });
      }));
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: p };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() req: Request) {
    const p = await this.patients.findOne({
      where: { id },
      relations: { examens: { rapport: true, demandePar: true } },
      order: { examens: { creeLe: 'DESC' } },
    });
    if (!p) throw new NotFoundException('Patient introuvable');
    // Un médecin ne voit le rapport qu'une fois validé par un radiologue
    if (user.role === Role.MEDECIN) {
      for (const e of p.examens ?? []) if (e.statut !== ExamStatus.VALIDE) e.rapport = null;
    }
    await this.audit.log('DOSSIER_CONSULTE', { user, entite: 'patient', entiteId: id, ip: clientIp(req) });
    return p;
  }

  @Post()
  async creer(@Body() dto: CreatePatientDto, @CurrentUser() user: User, @Req() req: Request) {
    const annee = new Date().getFullYear();
    const n = await this.patients.count();
    let numero = `HPZ-${annee}-${String(n + 1).padStart(6, '0')}`;
    while (await this.patients.exist({ where: { numeroDossier: numero } })) {
      numero = `HPZ-${annee}-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`;
    }
    const p = await this.patients.save(this.patients.create({
      ...dto, prenom: dto.prenom.trim(), nom: dto.nom.trim().toUpperCase(), numeroDossier: numero, creePar: { id: user.id } as User,
    }));
    await this.audit.log('PATIENT_CREE', { user, entite: 'patient', entiteId: p.id, details: numero, ip: clientIp(req) });
    return p;
  }
}
