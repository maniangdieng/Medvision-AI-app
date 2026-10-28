'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Icone } from '@/components/Icone';
import { useToast } from '@/components/Toasts';
import { Alerte, Bouton } from '@/components/ui';
import { api } from '@/lib/api';
import type { Patient } from '@/lib/types';

export default function NouveauPatient() {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ prenom: '', nom: '', dateNaissance: '', sexe: '', telephone: '', adresse: '' });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const maj = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(''); setEnvoi(true);
    const corps = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
    try {
      const p = await api<Patient>('/patients', { method: 'POST', json: corps });
      toast('ok', `Dossier ${p.numeroDossier} créé pour ${p.prenom} ${p.nom}.`);
      router.replace(`/patients/${p.id}`);
    } catch (err) { setErreur((err as Error).message); setEnvoi(false); }
  }

  return (
    <>
      <div className="fil"><Link href="/patients">Patients</Link><Icone nom="chevron-droite" taille={14} />Nouveau</div>
      <div className="entete"><div><h1>Nouveau patient</h1><p className="sous">Le numéro de dossier est attribué automatiquement.</p></div></div>
      <form onSubmit={soumettre} className="panneau" style={{ maxWidth: 720 }}>
        <div className="panneau-corps pile">
          {erreur && <Alerte genre="erreur">{erreur}</Alerte>}
          <div className="grille-2">
            <div className="champ"><label htmlFor="prenom">Prénom</label><input id="prenom" type="text" required value={f.prenom} onChange={maj('prenom')} autoFocus /></div>
            <div className="champ"><label htmlFor="nom">Nom</label><input id="nom" type="text" required value={f.nom} onChange={maj('nom')} /></div>
            <div className="champ"><label htmlFor="dn">Date de naissance <span className="facultatif">(facultatif)</span></label><input id="dn" type="date" value={f.dateNaissance} onChange={maj('dateNaissance')} max={new Date().toISOString().slice(0, 10)} /></div>
            <div className="champ">
              <span className="etiquette">Sexe <span className="facultatif">(facultatif)</span></span>
              <div className="choix" role="group" aria-label="Sexe">
                {[['M', 'Masculin'], ['F', 'Féminin']].map(([v, l]) => (
                  <button type="button" key={v} aria-pressed={f.sexe === v} onClick={() => setF({ ...f, sexe: f.sexe === v ? '' : v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="champ"><label htmlFor="tel">Téléphone <span className="facultatif">(facultatif)</span></label><input id="tel" type="tel" placeholder="77 123 45 67" value={f.telephone} onChange={maj('telephone')} /></div>
            <div className="champ"><label htmlFor="adr">Adresse ou quartier <span className="facultatif">(facultatif)</span></label><input id="adr" type="text" value={f.adresse} onChange={maj('adresse')} /></div>
          </div>
        </div>
        <div className="pied-cr" style={{ justifyContent: 'flex-start' }}>
          <Bouton className="btn btn-principal" icone="check" chargement={envoi} disabled={!f.prenom.trim() || !f.nom.trim()}>{envoi ? 'Création…' : 'Créer le dossier'}</Bouton>
          <Link href="/patients" className="btn btn-fantome">Annuler</Link>
        </div>
      </form>
    </>
  );
}
