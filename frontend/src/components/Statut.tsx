'use client';
import { useAuth } from '@/lib/auth';
import { LIBELLE_STATUT, LIBELLE_STATUT_MEDECIN } from '@/lib/format';
import type { Statut as S } from '@/lib/types';
import { Spinner } from './ui';

export function Statut({ statut }: { statut: S }) {
  const { user } = useAuth();
  if (user?.role === 'MEDECIN') {
    return statut === 'VALIDE'
      ? <span className="statut statut-VALIDE">{LIBELLE_STATUT_MEDECIN.pret}</span>
      : <span className="statut statut-EN_ATTENTE">{LIBELLE_STATUT_MEDECIN.attente}</span>;
  }
  return (
    <span className={`statut statut-${statut}`}>
      {statut === 'ANALYSE_EN_COURS' && <Spinner taille={12} />}
      {LIBELLE_STATUT[statut]}
    </span>
  );
}
