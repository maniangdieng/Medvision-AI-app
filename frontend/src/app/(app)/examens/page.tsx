'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Icone } from '@/components/Icone';
import { ListeExamens } from '@/components/ListeExamens';
import { EtatVide, SqueletteTableau } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FILTRE_ATTENTE_MEDECIN, pluriel } from '@/lib/format';
import type { Examen, Page } from '@/lib/types';

const FILTRES = [
  { valeur: '', libelle: 'Tous' },
  { valeur: 'A_VALIDER', libelle: 'À valider' },
  { valeur: 'ANALYSE_EN_COURS,EN_ATTENTE', libelle: 'En cours' },
  { valeur: 'VALIDE', libelle: 'Validés' },
  { valeur: 'ECHEC', libelle: 'Échecs' },
];

const FILTRES_MEDECIN = [
  { valeur: '', libelle: 'Tous' },
  { valeur: FILTRE_ATTENTE_MEDECIN, libelle: 'Chez le radiologue' },
  { valeur: 'VALIDE', libelle: 'Comptes rendus disponibles' },
];

const VIDE: Record<string, string> = {
  [FILTRE_ATTENTE_MEDECIN]: 'Aucun examen en attente du radiologue.',
  A_VALIDER: 'Aucun compte rendu n’attend de validation.',
  'ANALYSE_EN_COURS,EN_ATTENTE': 'Aucune analyse en cours en ce moment.',
  VALIDE: 'Aucun compte rendu disponible pour l’instant.',
  ECHEC: 'Aucune analyse en échec. Tout fonctionne.',
};

function Liste() {
  const { user } = useAuth();
  const params = useSearchParams();
  const defaut = params.get('statut') ?? (user?.role === 'RADIOLOGUE' ? 'A_VALIDER' : '');
  const [filtre, setFiltre] = useState(defaut);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Page<Examen> | null>(null);

  useEffect(() => {
    setRes(null);
    api<Page<Examen>>(`/exams?statut=${filtre}&page=${page}`).then(setRes).catch(() => {});
  }, [filtre, page]);

  // Les analyses en cours avancent toutes seules : on rafraîchit la liste tant qu'il y en a
  useEffect(() => {
    if (!res?.items.some((e) => ['EN_ATTENTE', 'ANALYSE_EN_COURS'].includes(e.statut))) return;
    const t = setInterval(() => api<Page<Examen>>(`/exams?statut=${filtre}&page=${page}`).then(setRes).catch(() => {}), 6000);
    return () => clearInterval(t);
  }, [res, filtre, page]);

  const pages = res ? Math.ceil(res.total / 20) : 0;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Examens</h1>
          <p className="sous">{res ? pluriel(res.total, 'examen', 'examens') : ' '} · pour un nouvel examen, ouvrez d’abord le dossier du patient.</p>
        </div>
        {user?.role === 'RADIOLOGUE' && <Link href="/patients" className="btn"><Icone nom="plus" />Nouvel examen</Link>}
      </div>
      <div className="choix" role="group" aria-label="Filtrer par statut" style={{ marginBottom: 18 }}>
        {(user?.role === 'MEDECIN' ? FILTRES_MEDECIN : FILTRES).map((f) => (
          <button key={f.valeur} aria-pressed={filtre === f.valeur} onClick={() => { setFiltre(f.valeur); setPage(1); }}>{f.libelle}</button>
        ))}
      </div>
      <section className="panneau">
        {!res ? <SqueletteTableau /> : res.items.length === 0 ? (
          <EtatVide icone={filtre === 'ECHEC' || filtre === 'A_VALIDER' ? 'check-cercle' : 'examens'} titre={VIDE[filtre] ?? 'Aucun examen pour le moment.'}>
            {filtre ? 'Essayez un autre filtre pour voir les autres examens.' : 'Les examens apparaîtront ici dès qu’un médecin aura envoyé des images.'}
          </EtatVide>
        ) : <ListeExamens examens={res.items} demandeur />}
      </section>
      {res && pages > 1 && (
        <div className="pagination">
          <span>Page {page} sur {pages}</span>
          <div className="ligne">
            <button className="btn btn-petit" disabled={page === 1} onClick={() => setPage(page - 1)}><Icone nom="chevron-gauche" />Précédent</button>
            <button className="btn btn-petit" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant<Icone nom="chevron-droite" /></button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Examens() {
  return <Suspense fallback={<div className="panneau"><SqueletteTableau /></div>}><Liste /></Suspense>;
}
