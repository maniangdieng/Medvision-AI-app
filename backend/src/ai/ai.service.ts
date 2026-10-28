import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';

export interface ResultatIA {
  rapport: string;
  nb_images: number;
  detections: unknown[];
  modele: string;
}

/**
 * Client du service d'inférence (Colab aujourd'hui, serveur GPU demain).
 * Seule AI_SERVICE_URL change entre les deux.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('IA');
  constructor(private readonly config: ConfigService) {}

  private url(): string {
    const u = (this.config.get<string>('AI_SERVICE_URL') || '').replace(/\/+$/, '');
    if (!u) throw new ServiceUnavailableException('Service IA non configuré (AI_SERVICE_URL)');
    return u;
  }

  async etat(): Promise<{ disponible: boolean; details?: unknown }> {
    try {
      const r = await fetch(`${this.url()}/health`, { signal: AbortSignal.timeout(8000) });
      return { disponible: r.ok, details: r.ok ? await r.json() : undefined };
    } catch {
      return { disponible: false };
    }
  }

  /** Démarre le moteur IA à l'avance (machine à la demande) ; un échec est sans conséquence. */
  async prechauffer(): Promise<void> {
    try {
      await fetch(`${this.url()}/warmup`, {
        method: 'POST',
        headers: { 'X-API-Key': this.config.get<string>('AI_API_KEY', '') },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* Colab ou serveur sans /warmup : l'analyse démarrera simplement à froid */ }
  }

  async analyser(
    fichiers: { chemin: string; nom: string; mime: string }[],
    meta: {
      region: string; patientLabel: string; indication?: string | null; question?: string | null;
      modalite?: string; patientInfo?: string;
    },
    /** Permet d'interrompre l'attente quand le radiologue arrête l'analyse. */
    annulation?: AbortSignal,
  ): Promise<ResultatIA> {
    const form = new FormData();
    for (const f of fichiers) {
      const data = await fs.readFile(f.chemin);
      form.append('files', new Blob([data], { type: f.mime }), f.nom);
    }
    form.append('region', meta.region);
    form.append('patient_label', meta.patientLabel);
    form.append('indication', meta.indication || '');
    form.append('question', meta.question || '');
    form.append('modalite', meta.modalite || '');
    form.append('patient_info', meta.patientInfo || '');

    const minutes = Number(this.config.get('AI_TIMEOUT_MIN', '10'));
    let r: Response;
    try {
      r = await fetch(`${this.url()}/analyze`, {
        method: 'POST',
        headers: { 'X-API-Key': this.config.get<string>('AI_API_KEY', '') },
        body: form,
        signal: annulation ? AbortSignal.any([AbortSignal.timeout(minutes * 60_000), annulation]) : AbortSignal.timeout(minutes * 60_000),
      });
    } catch (e) {
      this.logger.warn(`Service IA injoignable : ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'Service IA injoignable. Vérifiez que le notebook Colab tourne et que AI_SERVICE_URL est à jour.',
      );
    }
    if (!r.ok) {
      let detail = `${r.status}`;
      try { detail = ((await r.json()) as { detail?: string }).detail || detail; } catch { /* corps non JSON */ }
      throw new ServiceUnavailableException(`Le service IA a refusé l'analyse : ${detail}`);
    }
    return (await r.json()) as ResultatIA;
  }
}
