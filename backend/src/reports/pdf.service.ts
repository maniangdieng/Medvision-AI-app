import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Exam, ExamStatus } from '../entities';

// Mêmes teintes que l'interface web : le PDF reste reconnaissable une fois imprimé
const ENCRE = '#0E1B16';
const ENCRE_2 = '#3F4F49';
const ENCRE_3 = '#7B8B85';
const TRAIT = '#E3E9E6';
const VERT = '#0B7A5C';
const VERT_FONCE = '#075A44';
const VERT_VIF = '#12B886';
const LUEUR = '#34D3A6';
const VERT_PALE = '#EAF6F0';
const ROUGE = '#C0261A';
const ROUGE_PALE = '#FDECEB';
const AMBRE = '#B45309';
const AMBRE_PALE = '#FEF3E3';
const FOND = '#F5F8F7';
const NEGATO = '#09130F';
const ARDOISE = '#2563A8';
const ARDOISE_PALE = '#EEF4FB';

const M = 44; // marge latérale
const TZ = { timeZone: 'Africa/Dakar' } as const;
// Bornes de la taille du corps de texte : on prend la plus grande qui fait tenir le compte rendu sur une page
const F_MAX = 10.5;
const F_MIN = 7;

const SECTIONS = [
  "TYPE D'EXAMEN", 'INDICATION CLINIQUE', 'TECHNIQUE', 'OBSERVATIONS GLOBALES', 'OBSERVATIONS',
  'ANOMALIES DÉTECTÉES', 'ANOMALIES DETECTEES', 'ANOMALIES', 'IMPRESSION DIAGNOSTIQUE', 'IMPRESSION', 'RECOMMANDATIONS',
];
const REGIONS: Record<string, string> = {
  thorax: 'Thorax', cerveau: 'Cerveau / crâne', abdomen: 'Abdomen', os: 'Os / articulations', 'général': 'Examen général',
};
const MENTION =
  'Compte rendu pré-rédigé avec l’aide d’un outil d’intelligence artificielle, puis relu et validé par le radiologue signataire, ' +
  'seul responsable du diagnostic.';

/** Découpe le texte RSNA en sections (même logique que extraire_sections du notebook). */
export function extraireSections(texte: string): [string, string][] {
  const out: [string, string][] = [];
  let courant: string | null = null;
  let buf: string[] = [];
  const pousser = () => { if (courant && buf.join(' ').trim()) out.push([courant, buf.join('\n').trim()]); };
  for (const brute of texte.split('\n')) {
    const l = brute.trim();
    if (!l) continue;
    const propre = l.replace(/\*+/g, '').trim();
    const avant = propre.split(':')[0].trim().toUpperCase();
    const titre = avant.length < 60 ? SECTIONS.find((m) => avant.startsWith(m)) : undefined;
    if (titre) {
      pousser();
      courant = titre;
      buf = [];
      const reste = propre.includes(':') ? propre.slice(propre.indexOf(':') + 1).trim() : '';
      if (reste.length > 2) buf.push(reste);
    } else if (!l.startsWith('#')) {
      if (!courant) courant = 'COMPTE RENDU';
      buf.push(propre.replace(/^[-•]\s*/, '• '));
    }
  }
  pousser();
  return out;
}

/** Regroupe les sections RSNA sous des clés stables, quel que soit l'ordre ou l'intitulé exact choisi par l'IA. */
export function regrouperSections(texte: string) {
  const g = { type: '', indication: '', technique: '', observations: '', anomalies: '', conclusion: '', recommandations: '' };
  const ajouter = (cle: keyof typeof g, t: string) => { g[cle] = g[cle] ? `${g[cle]}\n${t}` : t; };
  for (const [titre, contenu] of extraireSections(texte)) {
    if (titre === "TYPE D'EXAMEN") ajouter('type', contenu);
    else if (titre === 'INDICATION CLINIQUE') ajouter('indication', contenu);
    else if (titre === 'TECHNIQUE') ajouter('technique', contenu);
    else if (titre.startsWith('ANOMALIES')) ajouter('anomalies', contenu);
    else if (titre.startsWith('IMPRESSION')) ajouter('conclusion', contenu);
    else if (titre === 'RECOMMANDATIONS') ajouter('recommandations', contenu);
    else ajouter('observations', contenu); // OBSERVATIONS, ou texte libre sans titre
  }
  return g;
}

const date = (d: Date | string) => new Date(d).toLocaleDateString('fr-FR', TZ);
const dateHeure = (d: Date | string) =>
  new Date(d).toLocaleString('fr-FR', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** « Aucune anomalie… », « Pas de… » : la section anomalies passe alors en vert au lieu du rouge. */
const rienASignaler = (t: string) => /^(•\s*)?(aucun|aucune|pas d|absence d|néant|rien)/i.test(t.trim());

type Bloc = { titre: string; contenu: string; couleur: string; pale: string; conclusion?: boolean };

@Injectable()
export class PdfService {
  private readonly logger = new Logger('PDF');

  /**
   * Compte rendu tenant toujours sur UNE page A4 : le corps de texte est réduit (de 10,5 à 7 pt) jusqu'à ce que
   * tout tienne ; au-delà, la section la plus longue est tronquée avec un renvoi vers l'application.
   * `images` : chemins de 0 ou 1 image PNG/JPG de l'examen, montrée comme image de référence.
   */
  generer(exam: Exam, images: string[] = []): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Marges haute et basse à 0 : pdfkit n'ajoute jamais de page de lui-même, la mise en page est calculée ici
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 0, bottom: 0, left: M, right: M },
        info: { Title: `Compte rendu ${exam.patient.numeroDossier}`, Author: 'MedVision' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const valide = exam.statut === ExamStatus.VALIDE;
      const r = exam.rapport!;
      const p = exam.patient;
      const s = regrouperSections(r.texteFinal);
      const W = doc.page.width;
      const H = doc.page.height;
      const L = W - 2 * M; // largeur utile
      const PIED = H - 40; // filet du pied de page
      const etiquette = (texte: string, x: number, y: number, couleur = ENCRE_3, opts: PDFKit.Mixins.TextOptions = {}) =>
        doc.fillColor(couleur).font('Helvetica-Bold').fontSize(6.8).text(texte.toUpperCase(), x, y, { characterSpacing: 0.7, lineBreak: false, ...opts });
      const coche = (cx: number, cy: number, rayon: number, fond: string) => {
        doc.circle(cx, cy, rayon).fill(fond);
        doc.moveTo(cx - rayon * 0.42, cy + rayon * 0.02).lineTo(cx - rayon * 0.1, cy + rayon * 0.34).lineTo(cx + rayon * 0.45, cy - rayon * 0.3)
          .lineWidth(rayon * 0.22).lineCap('round').lineJoin('round').strokeColor('#FFFFFF').stroke();
      };
      const hauteur = (t: string, police: string, taille: number, largeur: number) =>
        doc.font(police).fontSize(taille).heightOfString(t, { width: largeur, lineGap: taille * 0.28 });

      // ── Bandeau d'en-tête sombre (comme la barre latérale de l'application) ──
      doc.rect(0, 0, W, 80).fill(doc.linearGradient(0, 0, W, 80).stop(0, NEGATO).stop(0.65, '#0D2A21').stop(1, '#0F3A2C'));
      doc.rect(0, 80, W, 3).fill(doc.linearGradient(0, 0, W, 0).stop(0, VERT).stop(0.5, VERT_VIF).stop(1, LUEUR));
      doc.roundedRect(M, 22, 36, 36, 10).fill(doc.linearGradient(M, 22, M + 36, 58).stop(0, '#2EE0AA').stop(1, VERT));
      doc.rect(M + 15, 30, 6, 20).rect(M + 8, 37, 20, 6).fill('#FFFFFF');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text('MedVision', M + 48, 24, { lineBreak: false });
      doc.fillColor('#8FB3A5').font('Helvetica').fontSize(8.5).text('Service d’imagerie médicale', M + 48, 45, { lineBreak: false });

      const pastille = valide ? 'COMPTE RENDU VALIDÉ' : 'BROUILLON NON VALIDÉ';
      doc.roundedRect(W - M - 138, 22, 138, 22, 11).fill(valide ? LUEUR : '#F59E0B');
      doc.fillColor(NEGATO).font('Helvetica-Bold').fontSize(8)
        .text(pastille, W - M - 138, 29, { width: 138, align: 'center', characterSpacing: 0.4, lineBreak: false });
      doc.fillColor('#8FB3A5').font('Helvetica').fontSize(7.5)
        .text(`Édité le ${dateHeure(new Date())}`, W - M - 200, 52, { width: 200, align: 'right', lineBreak: false });

      // ── Titre ──────────────────────────────────────────────────────────
      let y = 100;
      etiquette('Compte rendu d’imagerie', M, y, VERT);
      doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(17)
        .text(`${exam.modalite} · ${REGIONS[exam.region] ?? exam.region}`, M, y + 11, { width: L, lineBreak: false, ellipsis: true });
      const demande = `Demandé le ${dateHeure(exam.creeLe)}${exam.demandePar ? ` par Dr ${exam.demandePar.prenom} ${exam.demandePar.nom}` : ''}`;
      doc.fillColor(ENCRE_3).font('Helvetica').fontSize(8.5)
        .text([s.type.replace(/\s+/g, ' '), demande].filter(Boolean).join('   ·   '), M, y + 33, { width: L, lineBreak: false, ellipsis: true });
      y += 52;

      // ── Fiche patient : pastille d'initiales + grille 3 × 2 ────────────
      const age = p.dateNaissance ? `${Math.floor((Date.now() - new Date(p.dateNaissance).getTime()) / 31_557_600_000)} ans` : '';
      const sexe = p.sexe === 'M' ? 'Masculin' : p.sexe === 'F' ? 'Féminin' : '';
      const cases: [string, string][] = [
        ['Patient', `${p.nom} ${p.prenom}`],
        ['N° de dossier', p.numeroDossier],
        ['Âge · sexe', [age, sexe].filter(Boolean).join(' · ')],
        ['Né(e) le', p.dateNaissance ? date(p.dateNaissance) : ''],
        ['Date de l’examen', date(exam.creeLe)],
        ['Images analysées', String(r.nbImagesAnalysees)],
      ];
      const hFiche = 64;
      doc.roundedRect(M, y, L, hFiche, 12).fillAndStroke(FOND, TRAIT);
      doc.circle(M + 32, y + hFiche / 2, 19).fill(doc.linearGradient(M + 13, y, M + 51, y + hFiche).stop(0, VERT_VIF).stop(1, VERT_FONCE));
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12)
        .text(`${p.prenom[0] ?? ''}${p.nom[0] ?? ''}`.toUpperCase(), M + 13, y + hFiche / 2 - 6, { width: 38, align: 'center', lineBreak: false });
      const x0 = M + 64;
      const colL = (L - 64) / 3;
      cases.forEach(([label, val], i) => {
        const x = x0 + (i % 3) * colL;
        const yy = y + 11 + Math.floor(i / 3) * 24;
        etiquette(label, x, yy);
        doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(9.5).text(val || '—', x, yy + 9, { width: colL - 10, lineBreak: false, ellipsis: true });
      });
      y += hFiche + 14;

      // ── Contenu à faire tenir : contexte clinique + sections dans un ordre fixe ──
      // Les rubriques manquantes restent visibles (« Non renseigné ») pour que le lecteur sache ce qui n'a pas été dit
      const contexte: [string, string][] = [
        ['Indication', exam.indication?.trim() || s.indication || ''],
        ...(exam.question?.trim() ? [['Question posée', exam.question.trim()] as [string, string]] : []),
        ['Technique', s.technique],
      ];
      const sansAnomalie = rienASignaler(s.anomalies);
      const blocs: Bloc[] = [
        { titre: 'Observations', contenu: s.observations, couleur: VERT, pale: VERT_PALE },
        { titre: 'Anomalies détectées', contenu: s.anomalies, couleur: sansAnomalie ? VERT : ROUGE, pale: sansAnomalie ? VERT_PALE : ROUGE_PALE },
        { titre: 'Conclusion', contenu: s.conclusion, couleur: VERT, pale: VERT_PALE, conclusion: true },
        { titre: 'Recommandations', contenu: s.recommandations, couleur: ARDOISE, pale: ARDOISE_PALE },
      ];

      const image = images[0];
      const tImg = 124;
      const xCtx = image ? M + tImg + 12 : M;
      const lCtx = image ? L - tImg - 12 : L;
      const lBloc = L - 12; // texte d'une section, en retrait sous son bandeau
      const lConcl = L - 52;
      const policeCtx = (t: string) => (t ? 'Helvetica' : 'Helvetica-Oblique');
      const tailleCtx = (f: number) => Math.max(f - 1, 7.5);
      const policeBloc = (b: Bloc) => (!b.contenu ? 'Helvetica-Oblique' : b.conclusion ? 'Helvetica-Bold' : 'Helvetica');
      const tailleBloc = (b: Bloc, f: number) => (b.conclusion && b.contenu ? f + 0.5 : f);
      const texteBloc = (b: Bloc) => b.contenu || 'Non renseigné';

      const hCtxTexte = (f: number) =>
        contexte.map(([, t]) => hauteur(t || 'Non renseignée', policeCtx(t), tailleCtx(f), lCtx - 28));
      const hLigneCtx = (f: number) => Math.max(image ? tImg : 0, 24 + hCtxTexte(f).reduce((a, h) => a + 11 + h + 6, 0) + 4);
      const hTextes = (f: number) => blocs.map((b) => hauteur(texteBloc(b), policeBloc(b), tailleBloc(b, f), b.conclusion ? lConcl : lBloc));
      const hBloc = (b: Bloc, hTexte: number) => (b.conclusion ? 26 + hTexte + 12 + 10 : 18 + 6 + hTexte + 11);

      const hSignature = valide && r.validePar ? 54 : 30;
      const hMention = hauteur(MENTION, 'Helvetica-Oblique', 7, L);
      const dispo = PIED - 12 - hMention - 8 - hSignature - 12 - y;
      const total = (f: number) => hLigneCtx(f) + 14 + hTextes(f).reduce((a, h, i) => a + hBloc(blocs[i], h), 0);

      let f = F_MAX;
      while (f > F_MIN && total(f) > dispo) f -= 0.25;
      // Dernier recours (texte très long) : on raccourcit la section la plus longue plutôt que de créer une 2e page
      const limites: (number | undefined)[] = blocs.map(() => undefined);
      const exces = total(f) - dispo;
      if (exces > 0) {
        const h = hTextes(f);
        const i = h.indexOf(Math.max(...h));
        limites[i] = Math.max(f * 3, h[i] - exces);
        this.logger.warn(`Compte rendu ${exam.id} trop long pour une page : section « ${blocs[i].titre} » tronquée`);
      }

      // ── Image de référence (cadre négatoscope) + contexte clinique ─────
      const hCtx = hLigneCtx(f);
      if (image) {
        doc.roundedRect(M, y, tImg, tImg, 12).fill(NEGATO);
        try {
          doc.save().roundedRect(M + 6, y + 6, tImg - 12, tImg - 24, 8).clip();
          doc.image(image, M + 6, y + 6, { fit: [tImg - 12, tImg - 24], align: 'center', valign: 'center' });
          doc.restore();
        } catch (e) {
          doc.restore();
          this.logger.warn(`Image non insérée dans le PDF : ${(e as Error).message}`);
        }
        doc.fillColor('#8FB3A5').font('Helvetica').fontSize(6.5)
          .text('IMAGE DE RÉFÉRENCE', M, y + tImg - 14, { width: tImg, align: 'center', characterSpacing: 0.6, lineBreak: false });
      }
      doc.roundedRect(xCtx, y, lCtx, hCtx, 12).fill(ARDOISE_PALE);
      etiquette('Contexte clinique et technique', xCtx + 14, y + 12, ARDOISE);
      let yc = y + 26;
      contexte.forEach(([titre, texte]) => {
        doc.fillColor(ENCRE_3).font('Helvetica-Bold').fontSize(7.5).text(titre, xCtx + 14, yc, { lineBreak: false });
        doc.fillColor(texte ? ENCRE_2 : ENCRE_3).font(policeCtx(texte)).fontSize(tailleCtx(f))
          .text(texte || 'Non renseignée', xCtx + 14, yc + 11, { width: lCtx - 28, lineGap: tailleCtx(f) * 0.28 });
        yc = doc.y + 6;
      });
      y += hCtx + 14;

      // ── Sections numérotées, chacune sous un bandeau coloré ────────────
      blocs.forEach((b, i) => {
        const opts: PDFKit.Mixins.TextOptions = { lineGap: tailleBloc(b, f) * 0.28 };
        if (limites[i] !== undefined) Object.assign(opts, { height: limites[i], ellipsis: '… (texte intégral dans MedVision)' });
        const vide = !b.contenu;
        if (b.conclusion) {
          // La conclusion est ce que le médecin lit en premier : encadrée, en gras, avec une coche
          const hT = limites[i] ?? hTextes(f)[i];
          const h = 26 + hT + 12;
          doc.roundedRect(M, y, L, h, 10).lineWidth(1).fillAndStroke(b.pale, '#BDE2D2');
          coche(M + 20, y + 19, 10, vide ? ENCRE_3 : VERT);
          etiquette(`${i + 1}   ${b.titre}`, M + 38, y + 12, b.couleur, { characterSpacing: 0.9 });
          doc.fillColor(vide ? ENCRE_3 : ENCRE).font(policeBloc(b)).fontSize(tailleBloc(b, f))
            .text(texteBloc(b), M + 38, y + 26, { width: lConcl, ...opts });
          y += h + 10;
          return;
        }
        doc.roundedRect(M, y, L, 18, 5).fill(b.pale);
        doc.roundedRect(M, y, 4, 18, 2).fill(b.couleur);
        doc.circle(M + 17, y + 9, 6.5).fill(b.couleur);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5).text(String(i + 1), M + 10.5, y + 5.6, { width: 13, align: 'center', lineBreak: false });
        etiquette(b.titre, M + 30, y + 6, b.couleur, { characterSpacing: 0.9 });
        doc.fillColor(vide ? ENCRE_3 : ENCRE_2).font(policeBloc(b)).fontSize(f)
          .text(texteBloc(b), M + 12, y + 24, { width: lBloc, ...opts });
        y += 18 + 6 + (limites[i] ?? hTextes(f)[i]) + 11;
      });

      // ── Validation et signature, calées au-dessus du pied de page ──────
      y = PIED - 12 - hMention - 8 - hSignature;
      if (valide && r.validePar) {
        doc.roundedRect(M, y, L, hSignature, 10).lineWidth(1).fillAndStroke('#FFFFFF', '#BDE2D2');
        coche(M + 24, y + hSignature / 2, 11, VERT_VIF);
        etiquette('Validé électroniquement par', M + 44, y + 11);
        doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(11).text(`Dr ${r.validePar.prenom} ${r.validePar.nom}`, M + 44, y + 21, { lineBreak: false });
        doc.fillColor(ENCRE_2).font('Helvetica').fontSize(8)
          .text(`Radiologue${r.validePar.service ? ` · ${r.validePar.service}` : ''} · le ${dateHeure(r.valideLe!)}`, M + 44, y + 36, { lineBreak: false });
        etiquette('Signature', W - M - 160, y + 11);
        doc.moveTo(W - M - 160, y + 42).lineTo(W - M - 16, y + 42).lineWidth(0.7).strokeColor('#9FB2AA').stroke();
      } else {
        doc.roundedRect(M, y, L, hSignature, 10).fill(AMBRE_PALE);
        doc.fillColor(AMBRE).font('Helvetica-Bold').fontSize(9)
          .text('Document non validé : ne pas utiliser pour une décision clinique.', M + 16, y + 10.5, { width: L - 32, lineBreak: false });
      }
      doc.fillColor(ENCRE_3).font('Helvetica-Oblique').fontSize(7)
        .text(MENTION, M, y + hSignature + 8, { width: L, lineGap: 7 * 0.28 });

      // ── Filigrane du brouillon et pied de page ─────────────────────────
      if (!valide) {
        doc.save().rotate(-35, { origin: [W / 2, H / 2] }).fillOpacity(0.06).fillColor(AMBRE)
          .font('Helvetica-Bold').fontSize(96).text('BROUILLON', 0, H / 2 - 50, { width: W, align: 'center', lineBreak: false })
          .restore();
      }
      doc.fillOpacity(1);
      doc.moveTo(M, PIED).lineTo(W - M, PIED).lineWidth(0.5).strokeColor(TRAIT).stroke();
      doc.roundedRect(M, PIED + 10, 9, 9, 2.5).fill(VERT);
      doc.fillColor(ENCRE_3).font('Helvetica').fontSize(7.5)
        .text(`MedVision · Dossier ${p.numeroDossier} · Document médical confidentiel, soumis au secret médical`, M + 14, PIED + 11, { lineBreak: false });
      doc.end();
    });
  }
}
