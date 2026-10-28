'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ChampMotDePasse } from '@/components/ChampMotDePasse';
import { Croix } from '@/components/Croix';
import { Icone } from '@/components/Icone';
import { Thorax } from '@/components/Thorax';
import { Alerte, Bouton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Utilisateur } from '@/lib/types';

export default function Connexion() {
  const router = useRouter();
  const { user, recharger } = useAuth();
  const [email, setEmail] = useState('');
  const [mdp, setMdp] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (user) router.replace(user.doitChangerMotDePasse ? '/mot-de-passe' : '/'); }, [user, router]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(''); setEnvoi(true);
    try {
      const u = await api<Utilisateur>('/auth/login', { method: 'POST', json: { email, motDePasse: mdp } });
      await recharger();
      router.replace(u.doitChangerMotDePasse ? '/mot-de-passe' : '/');
    } catch (err) {
      setErreur((err as Error).message);
      setMdp('');
      setEnvoi(false);
    }
  }

  return (
    <div className="connexion">
      <section className="connexion-visuel">
        <div className="connexion-scene" aria-hidden="true"><Thorax /><div className="balayage" /></div>
        <div className="connexion-marque"><span className="marque-croix"><Croix /></span>MedVision</div>
        <div className="texte">
          <h1>Le compte rendu radiologique, <em>assisté par l’IA.</em></h1>
          <ul className="atouts">
            <li><Icone nom="etincelle" />Un pré-rapport structuré, rédigé par MedGemma</li>
            <li><Icone nom="bouclier" />Relu et validé par un radiologue avant diffusion</li>
            <li><Icone nom="examens" />DICOM, NIfTI, PNG, JPG et exports PACS en ZIP</li>
          </ul>
        </div>
        <p className="connexion-legal">Les rapports proposés par l’IA sont une aide à la rédaction : ils sont toujours relus et validés par un radiologue avant toute utilisation clinique.</p>
      </section>

      <section className="connexion-form">
        <form onSubmit={soumettre} className="pile" noValidate>
          <div>
            <h2>Bon retour parmi nous</h2>
            <p style={{ color: 'var(--encre-2)', marginTop: 6 }}>Connectez-vous avec le compte fourni par l’administrateur.</p>
          </div>
          {erreur && <Alerte genre="erreur">{erreur}</Alerte>}
          <div className="champ">
            <label htmlFor="email">Adresse email</label>
            <input id="email" type="email" autoComplete="username" placeholder="prenom.nom@hopital.sn" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="champ">
            <label htmlFor="mdp">Mot de passe</label>
            <ChampMotDePasse id="mdp" autoComplete="current-password" required value={mdp} onChange={setMdp} />
          </div>
          <Bouton className="btn btn-principal" chargement={envoi} disabled={!email || !mdp}>
            {envoi ? 'Connexion en cours…' : 'Se connecter'}
          </Bouton>
          <p className="aide">Mot de passe oublié ? Demandez une réinitialisation à l’administrateur du service : vous recevrez un mot de passe provisoire par e-mail.</p>
        </form>
        <p className="connexion-pied"><Icone nom="verrou" taille={14} />Accès réservé au personnel autorisé · toute activité est journalisée</p>
      </section>
    </div>
  );
}
