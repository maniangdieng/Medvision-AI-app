export type Role = 'ADMIN' | 'RADIOLOGUE' | 'MEDECIN';
export type Statut = 'EN_ATTENTE' | 'ANALYSE_EN_COURS' | 'A_VALIDER' | 'VALIDE' | 'ECHEC';

export interface Utilisateur {
  id: string; email: string; prenom: string; nom: string; role: Role; service?: string | null;
  actif: boolean; doitChangerMotDePasse: boolean; derniereConnexion?: string | null; creeLe: string;
  verrouilleJusqua?: string | null;
}
export interface Patient {
  id: string; numeroDossier: string; prenom: string; nom: string; dateNaissance?: string | null;
  sexe?: 'M' | 'F' | null; telephone?: string | null; adresse?: string | null; creeLe: string;
  nbExamens?: number; examens?: Examen[];
}
export interface Rapport {
  id: string; texteIA: string; texteFinal: string; nbImagesAnalysees: number; modele?: string;
  validePar?: Utilisateur | null; valideLe?: string | null; modifieLe: string;
}
export interface ImageExamen { id: string; nomOriginal: string; typeMime: string; taille: number; apercu: boolean }
export interface Examen {
  id: string; patient: Patient; region: string; modalite: string; indication?: string | null;
  question?: string | null; statut: Statut; erreur?: string | null; demandePar?: Utilisateur | null;
  images?: ImageExamen[]; rapport?: Rapport | null; creeLe: string; modifieLe: string;
}
export interface Page<T> { items: T[]; total: number; page: number }
