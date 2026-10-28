'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icone } from '@/components/Icone';
import { Avatar, EtatVide, Spinner, SqueletteTableau } from '@/components/ui';
import { api } from '@/lib/api';
import { age, date, pluriel } from '@/lib/format';
import type { Page, Patient } from '@/lib/types';

export default function Patients() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Page<Patient> | null>(null);
  const [recherche, setRecherche] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecherche(true);
    const t = setTimeout(() => {
      api<Page<Patient>>(`/patients?q=${encodeURIComponent(q)}&page=${page}`).then(setRes).catch(() => {}).finally(() => setRecherche(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, page]);

  // « / » place le curseur dans la recherche, comme sur la plupart des logiciels métier
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select')) { e.preventDefault(); champ.current?.focus(); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const pages = res ? Math.ceil(res.total / 20) : 0;

  return (
    <>
      <div className="entete">
        <div><h1>Patients</h1><p className="sous">{res ? `${pluriel(res.total, 'dossier', 'dossiers')} · recherchez un dossier ou créez-en un nouveau.` : ' '}</p></div>
        <Link href="/patients/nouveau" className="btn btn-principal"><Icone nom="utilisateur-plus" />Nouveau patient</Link>
      </div>
      <div className="recherche" style={{ marginBottom: 18, maxWidth: 560 }}>
        <Icone nom="recherche" />
        <input ref={champ} type="search" aria-label="Rechercher un patient" placeholder="Nom, prénom ou n° de dossier" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }} autoFocus />
        {recherche && res && <Spinner />}
        <kbd aria-hidden="true">/</kbd>
      </div>
      <section className="panneau">
        {!res ? <SqueletteTableau colonnes={5} /> : res.items.length === 0 ? (
          q
            ? <EtatVide icone="recherche" titre={`Aucun patient ne correspond à « ${q} »`} action={<Link href="/patients/nouveau" className="btn btn-principal"><Icone nom="plus" />Créer le dossier</Link>}>
                Vérifiez l’orthographe ou cherchez par numéro de dossier.
              </EtatVide>
            : <EtatVide icone="patients" titre="Aucun patient enregistré" action={<Link href="/patients/nouveau" className="btn btn-principal"><Icone nom="plus" />Créer le premier dossier</Link>}>
                Créez un dossier patient pour pouvoir lui associer des examens d’imagerie.
              </EtatVide>
        ) : (
          <div className="defile"><table className="tableau">
            <thead><tr><th>Patient</th><th>N° dossier</th><th className="masquable">Âge</th><th className="masquable">Examens</th><th className="masquable">Créé le</th><th aria-hidden="true" /></tr></thead>
            <tbody>
              {res.items.map((p) => (
                <tr key={p.id} className="cliquable" onClick={() => router.push(`/patients/${p.id}`)}>
                  <td>
                    <div className="personne">
                      <Avatar prenom={p.prenom} nom={p.nom} />
                      <Link href={`/patients/${p.id}`} className="nom" onClick={(e) => e.stopPropagation()}>{p.nom} {p.prenom}</Link>
                    </div>
                  </td>
                  <td className="dossier">{p.numeroDossier}</td>
                  <td className="masquable">{age(p.dateNaissance) || '—'}{p.sexe ? ` · ${p.sexe}` : ''}</td>
                  <td className="masquable"><span className="badge">{p.nbExamens ?? 0}</span></td>
                  <td className="masquable discret">{date(p.creeLe)}</td>
                  <td className="fleche"><Icone nom="chevron-droite" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
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
