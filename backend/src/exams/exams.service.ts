import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { AuditService } from '../audit/audit.service';
import { Exam, ExamImage, ExamStatus, Report, Role, User } from '../entities';

export function dossierUploads(): string {
  return path.resolve(process.env.UPLOAD_DIR || './uploads');
}

@Injectable()
export class ExamsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Examens');
  /** File d'attente : le GPU Colab ne traite qu'un dossier à la fois. */
  private file: Promise<void> = Promise.resolve();
  /** Analyse envoyée au service IA en ce moment, avec de quoi interrompre la requête. */
  private enCours: { id: string; ctrl: AbortController } | null = null;
  /** Analyses arrêtées pendant qu'elles attendaient leur tour dans la file. */
  private readonly annulees = new Set<string>();

  constructor(
    @InjectRepository(Exam) private readonly exams: Repository<Exam>,
    @InjectRepository(ExamImage) private readonly images: Repository<ExamImage>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly ai: AiService,
    private readonly audit: AuditService,
    readonly config: ConfigService,
  ) {}

  async trouver(id: string, user: User): Promise<Exam> {
    const e = await this.exams.findOne({
      where: { id },
      relations: { patient: true, images: true, rapport: true, demandePar: true, envoyePar: true },
    });
    if (!e) throw new NotFoundException('Examen introuvable');
    if (user.role === Role.MEDECIN) {
      // un médecin ne consulte que les examens qu'il a prescrits, et le rapport seulement une fois validé
      if (e.demandePar?.id !== user.id) throw new NotFoundException('Examen introuvable');
      if (e.statut !== ExamStatus.VALIDE) e.rapport = null;
    }
    return e;
  }

  /**
   * La file vit en mémoire : après un redémarrage du serveur, les analyses qui y étaient n'aboutiront jamais.
   * On les passe en échec pour qu'elles puissent être relancées, au lieu de rester « en cours » indéfiniment.
   */
  async onApplicationBootstrap(): Promise<void> {
    const r = await this.exams.update(
      { statut: In([ExamStatus.EN_ATTENTE, ExamStatus.ANALYSE_EN_COURS]) },
      { statut: ExamStatus.ECHEC, erreur: 'Analyse interrompue par un redémarrage du serveur. Relancez-la.' },
    );
    if (r.affected) this.logger.warn(`${r.affected} analyse(s) interrompue(s) par le redémarrage, passée(s) en échec`);
  }

  /** Met l'analyse en file et rend la main immédiatement. */
  planifierAnalyse(examId: string, user: User): void {
    this.annulees.delete(examId);
    this.file = this.file.then(() => this.analyser(examId, user)).catch(() => undefined);
  }

  private infoPatient(p: Exam['patient']): string {
    const age = p.dateNaissance ? `${Math.floor((Date.now() - new Date(p.dateNaissance).getTime()) / 31_557_600_000)} ans` : '';
    const sexe = p.sexe === 'M' ? 'masculin' : p.sexe === 'F' ? 'féminin' : '';
    return [age, sexe].filter(Boolean).join(', ');
  }

  /** Arrête une analyse en cours ou en attente ; l'examen passe en échec et peut être relancé. */
  async annulerAnalyse(examId: string, user: User): Promise<void> {
    const exam = await this.exams.findOneBy({ id: examId });
    if (!exam) throw new NotFoundException('Examen introuvable');
    if (![ExamStatus.EN_ATTENTE, ExamStatus.ANALYSE_EN_COURS].includes(exam.statut)) {
      throw new BadRequestException('Aucune analyse en cours pour cet examen');
    }
    if (this.enCours?.id === examId) this.enCours.ctrl.abort();
    else this.annulees.add(examId); // en attente dans la file, ou orpheline : ne sera pas lancée
    await this.exams.update(examId, { statut: ExamStatus.ECHEC, erreur: `Analyse arrêtée par Dr ${user.prenom} ${user.nom}.` });
  }

  private async analyser(examId: string, user: User): Promise<void> {
    if (this.annulees.delete(examId)) return;
    const exam = await this.exams.findOne({ where: { id: examId }, relations: { patient: true, rapport: true } });
    if (!exam || exam.statut === ExamStatus.VALIDE) return;
    const imgs = await this.images.createQueryBuilder('i').addSelect('i.cheminStockage')
      .where('i.examenId = :id', { id: examId }).getMany();

    await this.exams.update(examId, { statut: ExamStatus.ANALYSE_EN_COURS, erreur: null });
    const debut = Date.now();
    const ctrl = new AbortController();
    this.enCours = { id: examId, ctrl };
    try {
      const res = await this.ai.analyser(
        imgs.map((i) => ({ chemin: path.join(dossierUploads(), i.cheminStockage), nom: i.nomOriginal, mime: i.typeMime })),
        {
          region: exam.region,
          // le nom du patient ne quitte pas l'hôpital : seul le numéro de dossier est envoyé au service IA
          patientLabel: exam.patient.numeroDossier,
          indication: exam.indication,
          question: exam.question,
          modalite: exam.modalite,
          // âge et sexe seulement (pas d'identité) : ils orientent la lecture des images
          patientInfo: this.infoPatient(exam.patient),
        },
        ctrl.signal,
      );
      const donnees = {
        texteIA: res.rapport,
        texteFinal: res.rapport,
        detectionsInternes: res.detections,
        nbImagesAnalysees: res.nb_images,
        modele: res.modele,
      };
      if (exam.rapport) await this.reports.update(exam.rapport.id, donnees);
      else await this.reports.insert({ ...donnees, examen: { id: examId } });
      await this.exams.update(examId, { statut: ExamStatus.A_VALIDER });
      await this.audit.log('ANALYSE_IA_OK', { user, entite: 'examen', entiteId: examId,
        details: `${res.nb_images} images, ${Math.round((Date.now() - debut) / 1000)} s` });
    } catch (e) {
      if (ctrl.signal.aborted) return; // arrêtée à la demande : annulerAnalyse a déjà mis l'examen à jour
      const msg = (e as Error).message;
      this.logger.warn(`Analyse ${examId} échouée : ${msg}`);
      await this.exams.update(examId, { statut: ExamStatus.ECHEC, erreur: msg.slice(0, 500) });
      await this.audit.log('ANALYSE_IA_ECHEC', { user, entite: 'examen', entiteId: examId, details: msg });
    } finally {
      if (this.enCours?.ctrl === ctrl) this.enCours = null;
    }
  }

  async cheminImage(examId: string, imageId: string): Promise<ExamImage> {
    const img = await this.images.createQueryBuilder('i').addSelect('i.cheminStockage')
      .where('i.id = :imageId AND i.examenId = :examId', { imageId, examId }).getOne();
    if (!img || !img.apercu) throw new NotFoundException();
    return img;
  }

  async modifierRapport(examId: string, texte: string, user: User): Promise<Report> {
    const exam = await this.trouver(examId, user);
    if (!exam.rapport) throw new NotFoundException('Aucun rapport pour cet examen');
    if (exam.statut === ExamStatus.VALIDE) throw new ForbiddenException('Rapport déjà validé : il ne peut plus être modifié');
    await this.reports.update(exam.rapport.id, { texteFinal: texte });
    return this.reports.findOneByOrFail({ id: exam.rapport.id });
  }

  async validerRapport(examId: string, user: User): Promise<Exam> {
    const exam = await this.trouver(examId, user);
    if (!exam.rapport) throw new BadRequestException('Aucun rapport à valider');
    if (exam.statut !== ExamStatus.A_VALIDER) throw new BadRequestException('Cet examen n\'est pas en attente de validation');
    await this.reports.update(exam.rapport.id, { validePar: { id: user.id } as User, valideLe: new Date() });
    await this.exams.update(examId, { statut: ExamStatus.VALIDE });
    return this.trouver(examId, user);
  }

  async supprimerFichiers(noms: string[]): Promise<void> {
    await Promise.all(noms.map((n) => fs.unlink(path.join(dossierUploads(), n)).catch(() => undefined)));
  }
}
