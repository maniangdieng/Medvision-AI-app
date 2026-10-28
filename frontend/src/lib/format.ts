import type { Role, Statut } from './types';

export const LIBELLE_STATUT: Record<Statut, string> = {
  EN_ATTENTE: 'En file d’attente',
  ANALYSE_EN_COURS: 'Analyse en cours',
  A_VALIDER: 'À valider',
  VALIDE: 'Validé',
  ECHEC: 'Échec de l’analyse',
};
/** Le médecin ne voit pas le travail interne du service d'imagerie (IA, relecture) : deux états lui suffisent. */
export const LIBELLE_STATUT_MEDECIN = { attente: 'Chez le radiologue', pret: 'Compte rendu disponible' };
export const FILTRE_ATTENTE_MEDECIN = 'EN_ATTENTE,ANALYSE_EN_COURS,A_VALIDER,ECHEC';
export const LIBELLE_ROLE: Record<Role, string> = {
  ADMIN: 'Administrateur', RADIOLOGUE: 'Radiologue', MEDECIN: 'Médecin',
};
export const REGIONS: { valeur: string; libelle: string }[] = [
  { valeur: 'thorax', libelle: 'Thorax' },
  { valeur: 'cerveau', libelle: 'Cerveau / crâne' },
  { valeur: 'abdomen', libelle: 'Abdomen' },
  { valeur: 'os', libelle: 'Os / articulations' },
  { valeur: 'général', libelle: 'Autre (général)' },
];
export const MODALITES = ['Radiographie', 'IRM', 'Scanner', 'Échographie'];

const TZ = { timeZone: 'Africa/Dakar' } as const;
export const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', TZ) : '—');
export const dateHeure = (d?: string | null) =>
  d ? new Date(d).toLocaleString('fr-FR', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export function age(naissance?: string | null): string {
  if (!naissance) return '';
  const a = Math.floor((Date.now() - new Date(naissance).getTime()) / 31_557_600_000);
  return `${a} ans`;
}
export const libelleRegion = (r: string) => REGIONS.find((x) => x.valeur === r)?.libelle ?? r;
/** « 0 examen », « 1 examen », « 3 examens » (en français, 0 et 1 restent au singulier). */
export const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
export const taille =(o: number) => (o > 1e6 ? `${(o / 1e6).toFixed(1)} Mo` : `${Math.ceil(o / 1e3)} Ko`);
