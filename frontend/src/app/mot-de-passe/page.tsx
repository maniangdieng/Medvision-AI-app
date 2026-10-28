'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ChampMotDePasse } from '@/components/ChampMotDePasse';
import { Croix } from '@/components/Croix';
import { Icone } from '@/components/Icone';
import { useToast } from '@/components/Toasts';
import { Alerte, Bouton, EcranChargement } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const regles = [
  { test: (m: string) => m.length >= 10, texte: '10 caractères au moins' },
  { test: (m: string) => /[A-Z]/.test(m), texte: 'une majuscule' },
  { test: (m: string) => /[a-z]/.test(m), texte: 'une minuscule' },
  { test: (m: string) => /\d/.test(m), texte: 'un chiffre' },
];

export default function MotDePasse() {
  const router = useRouter();
  const toast = useToast();
  const { user, chargement, recharger, deconnecter } = useAuth();
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirm, setConfirm] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (!chargement && !user) router.replace('/connexion'); }, [user, chargement, router]);

  if (chargement || !user) return <EcranChargement />;

  const respectees = regles.filter((r) => r.test(nouveau)).length;
  const valide = respectees === regles.length && nouveau === confirm && ancien.length > 0;
  const premiere = user.doitChangerMotDePasse;

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(''); setEnvoi(true);
    try {
      await api('/auth/change-password', { method: 'POST', json: { ancienMotDePasse: ancien, nouveauMotDePasse: nouveau } });
      await recharger();
      toast('ok', premiere ? 'Mot de passe enregistré. Bienvenue sur MedVision !' : 'Mot de passe modifié.');
      router.replace('/');
    } catch (err) { setErreur((err as Error).message); setEnvoi(false); }
  }

  return (
    <div className="page-centree">
      <form onSubmit={soumettre} className="carte pile">
        <span className="marque-croix grand" style={{ width: 48, height: 48 }}><Croix taille={22} /></span>
        <div>
          <h2 style={{ fontSize: 23, fontWeight: 800 }}>{premiere ? 'Choisissez votre mot de passe' : 'Changer de mot de passe'}</h2>
          <p style={{ color: 'var(--encre-2)', marginTop: 6 }}>
            {premiere
              ? 'Le mot de passe reçu est provisoire. Remplacez-le par un mot de passe personnel avant d’accéder aux dossiers.'
              : 'Vos autres sessions seront fermées.'}
          </p>
        </div>
        {erreur && <Alerte genre="erreur">{erreur}</Alerte>}
        <div className="champ">
          <label htmlFor="a">{premiere ? 'Mot de passe provisoire' : 'Mot de passe actuel'}</label>
          <ChampMotDePasse id="a" autoComplete="current-password" value={ancien} onChange={setAncien} />
        </div>
        <div className="champ">
          <label htmlFor="n">Nouveau mot de passe</label>
          <ChampMotDePasse id="n" autoComplete="new-password" value={nouveau} onChange={setNouveau} />
          <div className="force" data-niveau={nouveau ? respectees : 0} aria-hidden="true"><span /><span /><span /><span /></div>
          <ul className="regles" aria-label="Règles du mot de passe">
            {regles.map((r) => {
              const ok = r.test(nouveau);
              return (
                <li key={r.texte} className={ok ? 'ok' : ''}>
                  <span className="marque-regle">{ok && <Icone nom="check" taille={10} />}</span>
                  {r.texte}<span className="sr">{ok ? ' : respecté' : ' : manquant'}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="champ">
          <label htmlFor="c">Confirmer le nouveau mot de passe</label>
          <ChampMotDePasse id="c" autoComplete="new-password" value={confirm} onChange={setConfirm} />
          {confirm && confirm !== nouveau && <span className="aide" style={{ color: 'var(--rouge)' }}>Les deux mots de passe sont différents.</span>}
          {confirm && confirm === nouveau && <span className="aide" style={{ color: 'var(--vert)' }}>Les deux mots de passe correspondent.</span>}
        </div>
        <Bouton className="btn btn-principal" chargement={envoi} disabled={!valide}>{envoi ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</Bouton>
        <div className="ligne" style={{ justifyContent: 'space-between' }}>
          {!premiere && <button type="button" className="btn btn-lien" onClick={() => router.back()}>Retour</button>}
          <button type="button" className="btn btn-lien" onClick={deconnecter} style={{ marginLeft: 'auto' }}>Se déconnecter</button>
        </div>
      </form>
    </div>
  );
}
