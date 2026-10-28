import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { clientIp, CurrentUser, Roles } from '../common/decorators';
import { Exam, ExamStatus, Patient, Role, User } from '../entities';
import { PdfService } from '../reports/pdf.service';
import { dossierUploads, ExamsService } from './exams.service';

export const REGIONS = ['thorax', 'cerveau', 'abdomen', 'os', 'général'];
export const MODALITES = ['Radiographie', 'IRM', 'Scanner', 'Échographie'];
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.dcm', '.dicom', '.nii', '.nii.gz', '.zip'];
const MIMES_APERCU: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function extension(nom: string): string {
  const n = nom.toLowerCase();
  return n.endsWith('.nii.gz') ? '.nii.gz' : path.extname(n);
}

class CreateExamDto {
  @IsUUID() patientId!: string;
  @IsIn(REGIONS) region!: string;
  @IsIn(MODALITES) modalite!: string;
  @IsOptional() @IsString() @MaxLength(1000) indication?: string;
  @IsOptional() @IsString() @MaxLength(500) question?: string;
}

class UpdateReportDto {
  @IsString() @MinLength(20) @MaxLength(20000) texteFinal!: string;
}

@Controller('exams')
@Roles(Role.MEDECIN, Role.RADIOLOGUE)
export class ExamsController {
  constructor(
    private readonly service: ExamsService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
    @InjectRepository(Exam) private readonly exams: Repository<Exam>,
    @InjectRepository(Patient) private readonly patients: Repository<Patient>,
  ) {}

  @Get('options')
  options() {
    return { regions: REGIONS, modalites: MODALITES, extensions: EXTENSIONS };
  }

  @Get()
  async liste(@Query('statut') statut?: string, @Query('page') page = '1') {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const statuts = (statut || '').split(',').filter((s) => (Object.values(ExamStatus) as string[]).includes(s)) as ExamStatus[];
    const [items, total] = await this.exams.findAndCount({
      where: statuts.length ? { statut: In(statuts) } : {},
      relations: { patient: true, demandePar: true },
      order: { creeLe: 'DESC' },
      skip: (p - 1) * 20,
      take: 20,
    });
    return { items, total, page: p };
  }

  @Post()
  @UseInterceptors(FilesInterceptor('fichiers', 20, {
    storage: diskStorage({
      destination: (_req, _f, cb) => cb(null, dossierUploads()),
      filename: (_req, f, cb) => cb(null, randomUUID() + extension(f.originalname)),
    }),
    limits: { fileSize: 50 * 1024 * 1024, files: 20 },
    fileFilter: (_req, f, cb) => {
      if (EXTENSIONS.includes(extension(f.originalname))) cb(null, true);
      else cb(new BadRequestException(`Format non accepté : ${f.originalname} (PNG, JPG, DICOM, NIfTI ou ZIP)`), false);
    },
  }))
  async creer(
    @Body() dto: CreateExamDto,
    @UploadedFiles() fichiers: Express.Multer.File[],
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    if (!fichiers?.length) throw new BadRequestException('Ajoutez au moins une image');
    const patient = await this.patients.findOneBy({ id: dto.patientId });
    if (!patient) {
      await this.service.supprimerFichiers(fichiers.map((f) => f.filename));
      throw new BadRequestException('Patient introuvable');
    }
    const exam = await this.exams.save(this.exams.create({
      patient,
      region: dto.region,
      modalite: dto.modalite,
      indication: dto.indication?.trim() || null,
      question: dto.question?.trim() || null,
      demandePar: { id: user.id } as User,
      images: fichiers.map((f) => {
        const ext = extension(f.originalname);
        return {
          nomOriginal: path.basename(f.originalname).slice(0, 200),
          cheminStockage: f.filename,
          typeMime: MIMES_APERCU[ext] || 'application/octet-stream',
          taille: f.size,
          apercu: ext in MIMES_APERCU,
        };
      }),
    }));
    await this.audit.log('EXAMEN_CREE', { user, entite: 'examen', entiteId: exam.id,
      details: `${patient.numeroDossier} · ${dto.modalite} ${dto.region} · ${fichiers.length} fichier(s)`, ip: clientIp(req) });
    this.service.planifierAnalyse(exam.id, user);
    return { id: exam.id };
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.service.trouver(id, user);
  }

  @Post(':id/analyze')
  @Roles(Role.RADIOLOGUE) // l'IA est l'outil du radiologue : le médecin ne voit que le compte rendu validé
  async relancer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const e = await this.service.trouver(id, user);
    if (e.statut === ExamStatus.VALIDE) throw new BadRequestException('Examen déjà validé');
    if (e.statut === ExamStatus.ANALYSE_EN_COURS) throw new BadRequestException('Analyse déjà en cours');
    await this.exams.update(id, { statut: ExamStatus.EN_ATTENTE, erreur: null });
    this.service.planifierAnalyse(id, user);
    return { ok: true };
  }

  @Post(':id/analyze/annuler')
  @Roles(Role.RADIOLOGUE)
  async annuler(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() req: Request) {
    await this.service.annulerAnalyse(id, user);
    await this.audit.log('ANALYSE_IA_ANNULEE', { user, entite: 'examen', entiteId: id, ip: clientIp(req) });
    return { ok: true };
  }

  @Get(':id/images/:imageId')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() res: Response,
  ) {
    const img = await this.service.cheminImage(id, imageId);
    res.setHeader('Content-Type', img.typeMime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(dossierUploads(), img.cheminStockage));
  }

  @Put(':id/rapport')
  @Roles(Role.RADIOLOGUE)
  async modifier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReportDto, @CurrentUser() user: User, @Req() req: Request) {
    const r = await this.service.modifierRapport(id, dto.texteFinal, user);
    await this.audit.log('RAPPORT_MODIFIE', { user, entite: 'examen', entiteId: id, ip: clientIp(req) });
    return r;
  }

  @Post(':id/rapport/valider')
  @Roles(Role.RADIOLOGUE)
  async valider(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() req: Request) {
    const e = await this.service.validerRapport(id, user);
    await this.audit.log('RAPPORT_VALIDE', { user, entite: 'examen', entiteId: id, ip: clientIp(req) });
    return e;
  }

  @Get(':id/rapport/pdf')
  async telecharger(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() req: Request, @Res() res: Response) {
    const e = await this.service.trouver(id, user);
    if (!e.rapport) throw new BadRequestException('Rapport non disponible');
    // Première image affichable (PNG/JPG) reprise dans le PDF comme image de référence
    const apercu = e.images?.find((i) => i.apercu);
    const chemin = apercu
      ? await this.service.cheminImage(id, apercu.id).then((i) => path.join(dossierUploads(), i.cheminStockage)).catch(() => null)
      : null;
    const buf = await this.pdf.generer(e, chemin ? [chemin] : []);
    await this.audit.log('RAPPORT_PDF', { user, entite: 'examen', entiteId: id, ip: clientIp(req) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CR_${e.patient.numeroDossier}_${e.id.slice(0, 8)}.pdf"`);
    res.send(buf);
  }
}
