'use client';
import { useEffect, useState } from 'react';
import { Icone } from '@/components/Icone';
import { EtatVide, SqueletteTableau } from '@/components/ui';
import { api } from '@/lib/api';
import { dateHeure, pluriel } from '@/lib/format';

interface Ligne { id: number; utilisateurEmail?: string; action: string; entite?: string; details?: string; ip?: string; date: string }

const ACTIONS: Record<string, string> = {
  CONNEXION: 'Connexion', CONNEXION_ECHEC: 'Échec de connexion', COMPTE_VERROUILLE: 'Compte verrouillé',
  CONNEXION_REFUSEE_VERROU: 'Connexion refusée (verrou)', DECONNEXION: 'Déconnexion', REUTILISATION_JETON: 'Jeton réutilisé (alerte)',
  MOT_DE_PASSE_CHANGE: 'Mot de passe changé', MOT_DE_PASSE_REINITIALISE: 'Mot de passe réinitialisé',
  MOT_DE_PASSE_DEFINI_PAR_ADMIN: 'Mot de passe défini par l’admin',
  UTILISATEUR_CREE: 'Compte créé', UTILISATEUR_MODIFIE: 'Compte modifié', PATIENT_CREE: 'Patient créé',
  DOSSIER_CONSULTE: 'Dossier consulté', EXAMEN_CREE: 'Examen créé', ANALYSE_IA_OK: 'Analyse IA terminée',
  ANALYSE_IA_ECHEC: 'Analyse IA échouée', ANALYSE_IA_ANNULEE: 'Analyse IA arrêtée', RAPPORT_MODIFIE: 'Compte rendu modifié', RAPPORT_VALIDE: 'Compte rendu validé',
  RAPPORT_PDF: 'PDF téléchargé',
};
const SENSIBLES = ['CONNEXION_ECHEC', 'COMPTE_VERROUILLE', 'REUTILISATION_JETON', 'ANALYSE_IA_ECHEC'];

export default function Journal() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [res, setRes] = useState<{ items: Ligne[]; total: number } | null>(null);

  useEffect(() => {
    setRes(null);
    api<{ items: Ligne[]; total: number }>(`/audit?page=${page}${action ? `&action=${action}` : ''}`).then(setRes).catch(() => {});
  }, [page, action]);

  const pages = res ? Math.ceil(res.total / 50) : 0;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Journal d’activité</h1>
          <p className="sous">{res ? `${pluriel(res.total, 'entrée', 'entrées')} · ` : ''}toutes les actions sur les comptes et les dossiers, conservées sans modification possible.</p>
        </div>
        <select aria-label="Filtrer par action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} style={{ width: 280 }}>
          <option value="">Toutes les actions</option>
          {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <section className="panneau">
        {!res ? <SqueletteTableau lignes={8} colonnes={4} /> : res.items.length === 0 ? (
          <EtatVide icone="journal" titre="Aucune entrée">{action ? 'Aucune action de ce type n’a encore été enregistrée.' : 'Le journal est vide pour le moment.'}</EtatVide>
        ) : (
          <div className="defile"><table className="tableau">
            <thead><tr><th>Date</th><th>Action</th><th>Utilisateur</th><th className="masquable">Détails</th><th className="masquable">Adresse IP</th></tr></thead>
            <tbody>
              {res.items.map((l) => (
                <tr key={l.id}>
                  <td className="discret" style={{ whiteSpace: 'nowrap' }}>{dateHeure(l.date)}</td>
                  <td>
                    {SENSIBLES.includes(l.action)
                      ? <span className="action-sensible"><Icone nom="alerte" taille={15} />{ACTIONS[l.action] ?? l.action}</span>
                      : <span style={{ fontWeight: 600 }}>{ACTIONS[l.action] ?? l.action}</span>}
                  </td>
                  <td>{l.utilisateurEmail || '—'}</td>
                  <td className="masquable discret"><div className="tronque" title={l.details}>{l.details || ''}</div></td>
                  <td className="masquable discret dossier">{l.ip || ''}</td>
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
            <button className="btn btn-petit" disabled={page === 1} onClick={() => setPage(page - 1)}><Icone nom="chevron-gauche" />Plus récent</button>
            <button className="btn btn-petit" disabled={page >= pages} onClick={() => setPage(page + 1)}>Plus ancien<Icone nom="chevron-droite" /></button>
          </div>
        </div>
      )}
    </>
  );
}
