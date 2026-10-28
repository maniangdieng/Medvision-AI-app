import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const HTML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => HTML[c]);

interface Destinataire { email: string; prenom: string; nom: string }

/**
 * E-mails transactionnels via l'API Brevo.
 * Sans BREVO_API_KEY ou MAIL_FROM, rien n'est envoyé : l'appelant affiche alors
 * le mot de passe provisoire à l'administrateur, comme avant.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  constructor(private readonly config: ConfigService) {}

  private lienConnexion(): string {
    const base = this.config.get<string>('APP_URL') || (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').split(',')[0];
    return `${base.trim().replace(/\/+$/, '')}/connexion`;
  }

  /** Renvoie true si Brevo a accepté l'e-mail. Ne lève jamais : un échec d'envoi ne doit pas bloquer la création du compte. */
  async envoyerMotDePasseProvisoire(dest: Destinataire, mdp: string, motif: 'creation' | 'reinitialisation'): Promise<boolean> {
    const cle = this.config.get<string>('BREVO_API_KEY', '').trim();
    const expediteur = this.config.get<string>('MAIL_FROM', '').trim();
    if (!cle || !expediteur) return false;

    const lien = this.lienConnexion();
    const sujet = motif === 'creation' ? 'Votre compte MedVision' : 'Votre nouveau mot de passe MedVision';
    const intro = motif === 'creation'
      ? 'Un compte MedVision vient d’être créé pour vous.'
      : 'Votre mot de passe MedVision a été réinitialisé par un administrateur.';
    const prenom = echapper(dest.prenom);

    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2d27;max-width:520px">
  <p>Bonjour ${prenom},</p>
  <p>${intro}</p>
  <p>Identifiant : <strong>${echapper(dest.email)}</strong><br>
  Mot de passe provisoire : <strong style="font-family:monospace;font-size:17px;letter-spacing:1px">${echapper(mdp)}</strong></p>
  <p><a href="${echapper(lien)}" style="display:inline-block;background:#0f6b4f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Se connecter</a></p>
  <p>Vous devrez choisir un nouveau mot de passe à la première connexion.</p>
  <p style="color:#6f8a7f;font-size:13px">Si vous n’attendiez pas cet e-mail, prévenez l’administrateur de MedVision.</p>
</div>`;
    const texte = `Bonjour ${dest.prenom},\n\n${intro}\n\nIdentifiant : ${dest.email}\nMot de passe provisoire : ${mdp}\n\n`
      + `Connexion : ${lien}\nVous devrez choisir un nouveau mot de passe à la première connexion.\n\n`
      + 'Si vous n’attendiez pas cet e-mail, prévenez l’administrateur de MedVision.';

    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': cle, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: this.config.get<string>('MAIL_FROM_NAME', 'MedVision'), email: expediteur },
          to: [{ email: dest.email, name: `${dest.prenom} ${dest.nom}` }],
          subject: sujet,
          htmlContent: html,
          textContent: texte,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) return true;
      let detail = `${r.status}`;
      try { detail += ` ${((await r.json()) as { message?: string }).message ?? ''}`; } catch { /* corps non JSON */ }
      this.logger.warn(`Brevo a refusé l'e-mail pour ${dest.email} : ${detail}`);
    } catch (e) {
      this.logger.warn(`Brevo injoignable : ${(e as Error).message}`);
    }
    return false;
  }
}
