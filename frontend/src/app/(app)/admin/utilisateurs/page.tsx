'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ChampMotDePasse } from '@/components/ChampMotDePasse';
import { useConfirmation } from '@/components/Confirmation';
import { Icone } from '@/components/Icone';
import { Tiroir } from '@/components/Tiroir';
import { useToast } from '@/components/Toasts';
import { Alerte, Avatar, Bouton, SqueletteTableau } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateHeure, LIBELLE_ROLE, pluriel } from '@/lib/format';
import type { Role, Utilisateur } from '@/lib/types';

const ROLES: Role[] = ['MEDECIN', 'RADIOLOGUE', 'ADMIN'];
const DESCRIPTION_ROLE: Record<Role, string> = {
  MEDECIN: 'Consulte les comptes rendus validés des examens qu’il a prescrits.',
  RADIOLOGUE: 'Enregistre les patients et les examens, dépose les images, puis relit, corrige et valide le compte rendu rédigé par l’IA.',
  ADMIN: 'Gère les comptes et consulte le journal d’activité. N’a pas accès aux dossiers médicaux.',
};
const VIERGE = { prenom: '', nom: '', email: '', role: 'MEDECIN' as Role, service: '' };

/** Réponse du backend : le mot de passe n'est renvoyé que si l'e-mail n'a pas pu partir. */
interface Provisoire { emailEnvoye: boolean; motDePasseProvisoire?: string }

function EtatCompte({ u }: { u: Utilisateur }) {
  if (!u.actif) return <span className="statut statut-ECHEC">Désactivé</span>;
  if (u.verrouilleJusqua && new Date(u.verrouilleJusqua) > new Date()) return <span className="statut statut-A_VALIDER">Verrouillé</span>;
  if (u.doitChangerMotDePasse) return <span className="statut statut-EN_ATTENTE">1re connexion attendue</span>;
  return <span className="statut statut-VALIDE">Actif</span>;
}

function ChoixRole({ valeur, onChange }: { valeur: Role; onChange: (r: Role) => void }) {
  return (
    <div className="champ">
      <span className="etiquette">Rôle</span>
      <div className="choix" role="group" aria-label="Rôle">
        {ROLES.map((r) => <button type="button" key={r} aria-pressed={valeur === r} onClick={() => onChange(r)}>{LIBELLE_ROLE[r]}</button>)}
      </div>
      <span className="aide">{DESCRIPTION_ROLE[valeur]}</span>
    </div>
  );
}

export default function Comptes() {
  const { user: moi } = useAuth();
  const confirmer = useConfirmation();
  const toast = useToast();
  const [liste, setListe] = useState<Utilisateur[] | null>(null);
  const [creation, setCreation] = useState(false);
  const [f, setF] = useState(VIERGE);
  const [provisoire, setProvisoire] = useState<{ email: string; mdp: string } | null>(null);
  const [erreur, setErreur] = useState('');
  const [erreurTiroir, setErreurTiroir] = useState('');
  const [edition, setEdition] = useState<Utilisateur | null>(null);
  const [e, setE] = useState(VIERGE);
  const [mdp, setMdp] = useState({ valeur: '', doitChanger: true });
  const [occupe, setOccupe] = useState<string | null>(null);

  const charger = useCallback(() => api<Utilisateur[]>('/users').then(setListe).catch((x) => setErreur(x.message)), []);
  useEffect(() => { charger(); }, [charger]);

  /** Mot de passe provisoire : envoyé par e-mail, sinon affiché une seule fois ici. */
  function signalerProvisoire(email: string, r: Provisoire) {
    if (r.emailEnvoye) toast('ok', `Mot de passe provisoire envoyé par e-mail à ${email}.`);
    else if (r.motDePasseProvisoire) setProvisoire({ email, mdp: r.motDePasseProvisoire });
  }

  async function creer(ev: FormEvent) {
    ev.preventDefault(); setErreurTiroir(''); setOccupe('creer');
    try {
      const r = await api<Provisoire & { utilisateur: Utilisateur }>('/users', { method: 'POST', json: { ...f, service: f.service || undefined } });
      setCreation(false); setF(VIERGE);
      toast('ok', `Compte de ${r.utilisateur.prenom} ${r.utilisateur.nom} créé.`);
      signalerProvisoire(r.utilisateur.email, r);
      charger();
    } catch (x) { setErreurTiroir((x as Error).message); } finally { setOccupe(null); }
  }

  function ouvrirEdition(u: Utilisateur) {
    setEdition(u); setErreurTiroir('');
    setE({ prenom: u.prenom, nom: u.nom, email: u.email, role: u.role, service: u.service ?? '' });
    setMdp({ valeur: '', doitChanger: true });
  }

  async function enregistrer(ev: FormEvent) {
    ev.preventDefault(); if (!edition) return; setErreurTiroir(''); setOccupe('enregistrer');
    try {
      await api(`/users/${edition.id}`, { method: 'PATCH', json: { ...e, service: e.service } });
      toast('ok', `Compte de ${e.prenom} ${e.nom} mis à jour.`); setEdition(null); charger();
    } catch (x) { setErreurTiroir((x as Error).message); } finally { setOccupe(null); }
  }

  async function definirMotDePasse() {
    if (!edition) return; setErreurTiroir(''); setOccupe('mdp');
    try {
      await api(`/users/${edition.id}/password`, { method: 'PUT', json: { motDePasse: mdp.valeur, doitChanger: mdp.doitChanger } });
      toast('ok', `Nouveau mot de passe défini pour ${edition.prenom} ${edition.nom}. La personne a été déconnectée de ses appareils.`);
      setMdp({ valeur: '', doitChanger: true }); charger();
    } catch (x) { setErreurTiroir((x as Error).message); } finally { setOccupe(null); }
  }

  async function basculer(u: Utilisateur) {
    if (u.actif && !(await confirmer({
      titre: `Désactiver le compte de ${u.prenom} ${u.nom} ?`,
      message: 'La personne sera déconnectée immédiatement et ne pourra plus se connecter. Vous pourrez réactiver le compte plus tard.',
      confirmer: 'Désactiver', danger: true,
    }))) return;
    setOccupe(`actif-${u.id}`); setErreur('');
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', json: { actif: !u.actif } });
      toast('ok', u.actif ? `Compte de ${u.prenom} ${u.nom} désactivé.` : `Compte de ${u.prenom} ${u.nom} réactivé.`);
      charger();
    } catch (x) { setErreur((x as Error).message); } finally { setOccupe(null); }
  }

  async function reinitialiser(u: Utilisateur) {
    if (!(await confirmer({
      titre: 'Générer un mot de passe provisoire ?',
      message: `L’ancien mot de passe de ${u.prenom} ${u.nom} ne fonctionnera plus et la personne sera déconnectée de ses appareils. Le nouveau lui sera envoyé par e-mail (ou affiché ici si l’envoi échoue).`,
      confirmer: 'Générer',
    }))) return;
    setOccupe(`reset-${u.id}`); setErreur('');
    try { signalerProvisoire(u.email, await api<Provisoire>(`/users/${u.id}/reset-password`, { method: 'POST' })); }
    catch (x) { setErreur((x as Error).message); } finally { setOccupe(null); }
  }

  async function copierProvisoire() {
    try { await navigator.clipboard.writeText(provisoire!.mdp); toast('ok', 'Mot de passe copié.'); }
    catch { toast('erreur', 'La copie n’est pas autorisée par le navigateur : recopiez-le à la main.'); }
  }

  const actifs = liste?.filter((u) => u.actif).length ?? 0;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Comptes</h1>
          <p className="sous">{liste ? `${pluriel(actifs, 'compte actif', 'comptes actifs')} · médecins, radiologues et administrateurs.` : ' '}</p>
        </div>
        <button className="btn btn-principal" onClick={() => { setCreation(true); setErreurTiroir(''); }}><Icone nom="utilisateur-plus" />Créer un compte</button>
      </div>
      {erreur && <div style={{ marginBottom: 16 }}><Alerte genre="erreur">{erreur}</Alerte></div>}

      {provisoire && (
        <div className="pile" style={{ marginBottom: 20 }}>
          <Alerte genre="ambre" action={<button className="btn btn-fantome btn-petit" onClick={() => setProvisoire(null)}>Masquer</button>}>
            <p><strong>L’e-mail n’a pas pu être envoyé.</strong> Mot de passe provisoire de <strong>{provisoire.email}</strong> : transmettez-le en main propre, il ne sera plus affiché. La personne devra le changer à sa première connexion.</p>
            <div className="ligne" style={{ marginTop: 10 }}>
              <span className="mdp-provisoire">{provisoire.mdp}</span>
              <button className="btn btn-petit" onClick={copierProvisoire}><Icone nom="copier" />Copier</button>
            </div>
          </Alerte>
        </div>
      )}

      <section className="panneau">
        {!liste ? <SqueletteTableau colonnes={5} /> : (
          <div className="defile"><table className="tableau">
            <thead><tr><th>Nom</th><th>Rôle</th><th className="masquable">Dernière connexion</th><th>État</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {liste.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="personne">
                      <Avatar prenom={u.prenom} nom={u.nom} />
                      <div><div className="nom">{u.prenom} {u.nom}{u.id === moi?.id && <span className="badge" style={{ marginLeft: 8 }}>vous</span>}</div><div className="discret">{u.email}</div></div>
                    </div>
                  </td>
                  <td><span className="modalite">{LIBELLE_ROLE[u.role]}</span>{u.service ? <div className="discret">{u.service}</div> : null}</td>
                  <td className="masquable discret">{u.derniereConnexion ? dateHeure(u.derniereConnexion) : 'Jamais'}</td>
                  <td><EtatCompte u={u} /></td>
                  <td className="actions">
                    <div className="ligne">
                      <button className="btn btn-fantome btn-petit" onClick={() => ouvrirEdition(u)} title="Modifier le compte" aria-label={`Modifier le compte de ${u.prenom} ${u.nom}`}><Icone nom="crayon" /><span>Modifier</span></button>
                      {u.id !== moi?.id && <>
                        <Bouton className="btn btn-fantome btn-petit" icone="cle" chargement={occupe === `reset-${u.id}`} onClick={() => reinitialiser(u)} title="Envoyer un mot de passe provisoire" aria-label={`Envoyer un mot de passe provisoire à ${u.prenom} ${u.nom}`}><span>Mot de passe</span></Bouton>
                        <Bouton className={`btn btn-fantome btn-petit${u.actif ? ' btn-danger' : ''}`} icone="marche" chargement={occupe === `actif-${u.id}`} onClick={() => basculer(u)}
                          title={u.actif ? 'Désactiver le compte' : 'Réactiver le compte'} aria-label={`${u.actif ? 'Désactiver' : 'Réactiver'} le compte de ${u.prenom} ${u.nom}`}><span>{u.actif ? 'Désactiver' : 'Réactiver'}</span></Bouton>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <Tiroir ouvert={creation} titre="Nouveau compte" sousTitre="Un mot de passe provisoire sera envoyé par e-mail à la personne." onFermer={() => setCreation(false)}>
        <form onSubmit={creer} className="pile">
          {erreurTiroir && <Alerte genre="erreur">{erreurTiroir}</Alerte>}
          <div className="grille-2">
            <div className="champ"><label htmlFor="p">Prénom</label><input id="p" type="text" required value={f.prenom} onChange={(x) => setF({ ...f, prenom: x.target.value })} /></div>
            <div className="champ"><label htmlFor="n">Nom</label><input id="n" type="text" required value={f.nom} onChange={(x) => setF({ ...f, nom: x.target.value })} /></div>
          </div>
          <div className="champ"><label htmlFor="m">Adresse email</label><input id="m" type="email" required placeholder="prenom.nom@hopital.sn" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} /></div>
          <div className="champ"><label htmlFor="s">Service <span className="facultatif">(facultatif)</span></label><input id="s" type="text" placeholder="Imagerie, Urgences, Pédiatrie…" value={f.service} onChange={(x) => setF({ ...f, service: x.target.value })} /></div>
          <ChoixRole valeur={f.role} onChange={(role) => setF({ ...f, role })} />
          <div className="ligne">
            <Bouton className="btn btn-principal" icone="mail" chargement={occupe === 'creer'}>Créer et envoyer l’invitation</Bouton>
            <button type="button" className="btn btn-fantome" onClick={() => setCreation(false)}>Annuler</button>
          </div>
        </form>
      </Tiroir>

      <Tiroir ouvert={!!edition} titre={edition ? `${edition.prenom} ${edition.nom}` : ''} sousTitre={edition?.email} onFermer={() => setEdition(null)}>
        {edition && <>
          {erreurTiroir && <Alerte genre="erreur">{erreurTiroir}</Alerte>}
          <form onSubmit={enregistrer} className="pile">
            <h3>Informations du compte</h3>
            <div className="grille-2">
              <div className="champ"><label htmlFor="ep">Prénom</label><input id="ep" type="text" required value={e.prenom} onChange={(x) => setE({ ...e, prenom: x.target.value })} /></div>
              <div className="champ"><label htmlFor="en">Nom</label><input id="en" type="text" required value={e.nom} onChange={(x) => setE({ ...e, nom: x.target.value })} /></div>
            </div>
            <div className="champ"><label htmlFor="em">Adresse email</label><input id="em" type="email" required value={e.email} onChange={(x) => setE({ ...e, email: x.target.value })} /></div>
            <div className="champ"><label htmlFor="es">Service <span className="facultatif">(facultatif)</span></label><input id="es" type="text" value={e.service} onChange={(x) => setE({ ...e, service: x.target.value })} /></div>
            {edition.id !== moi?.id && <ChoixRole valeur={e.role} onChange={(role) => setE({ ...e, role })} />}
            <div className="ligne">
              <Bouton className="btn btn-principal" icone="check" chargement={occupe === 'enregistrer'}>Enregistrer</Bouton>
              <button type="button" className="btn btn-fantome" onClick={() => setEdition(null)}>Fermer</button>
            </div>
          </form>

          {edition.id !== moi?.id && (
            <div className="pile tiroir-section">
              <h3><Icone nom="verrou" />Définir le mot de passe</h3>
              <p className="aide">Au moins 10 caractères, avec une majuscule, une minuscule et un chiffre. La personne sera déconnectée de tous ses appareils.</p>
              <div className="champ"><label htmlFor="emdp">Nouveau mot de passe</label>
                <ChampMotDePasse id="emdp" autoComplete="new-password" value={mdp.valeur} onChange={(v) => setMdp({ ...mdp, valeur: v })} />
              </div>
              <label className="case">
                <input type="checkbox" checked={mdp.doitChanger} onChange={(x) => setMdp({ ...mdp, doitChanger: x.target.checked })} />
                Exiger un nouveau mot de passe à la prochaine connexion (recommandé)
              </label>
              <div className="ligne">
                <Bouton type="button" className="btn" icone="cle" chargement={occupe === 'mdp'} disabled={mdp.valeur.length < 10} onClick={definirMotDePasse}>Définir ce mot de passe</Bouton>
              </div>
            </div>
          )}
        </>}
      </Tiroir>
    </>
  );
}
