'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EtatIA } from '@/components/EtatIA';
import { Icone, NomIcone } from '@/components/Icone';
import { ListeExamens } from '@/components/ListeExamens';
import { Alerte, ChiffreAnime, EtatVide, Squelette, SqueletteTableau } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FILTRE_ATTENTE_MEDECIN, pluriel } from '@/lib/format';
import type { Examen, Page } from '@/lib/types';

interface Stats { patients: number; examensJour: number; aValider: number; enCours: number; echecs: number; valides: number; utilisateurs: number }

function salutation() {
  // Le Sénégal est à UTC+0 toute l’année
  return new Date().getUTCHours() < 18 ? 'Bonjour' : 'Bonsoir';
}

function CarteStat({ href, icone, teinte, valeur, libelle }: { href?: string; icone: NomIcone; teinte?: 'ambre' | 'bleu'; valeur?: number; libelle: string }) {
  const contenu = (
    <>
      <span className="stat-icone"><Icone nom={icone} taille={20} /></span>
      <div>
        <div className="chiffre">{valeur === undefined ? <Squelette l={48} h={30} /> : <ChiffreAnime valeur={valeur} />}</div>
        <div className="libelle">{libelle}</div>
      </div>
    </>
  );
  const classe = `stat${teinte ? ` stat-${teinte}` : ''}`;
  return href ? <Link href={href} className={classe}>{contenu}</Link> : <div className={classe}>{contenu}</div>;
}

export default function TableauDeBord() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [examens, setExamens] = useState<Examen[] | null>(null);

  useEffect(() => {
    api<Stats>('/stats').then(setStats).catch(() => {});
    if (user && user.role !== 'ADMIN') {
      const filtre = user.role === 'RADIOLOGUE' ? '?statut=A_VALIDER,ECHEC,ANALYSE_EN_COURS,EN_ATTENTE' : '';
      api<Page<Examen>>(`/exams${filtre}`).then((p) => setExamens(p.items)).catch(() => setExamens([]));
    }
  }, [user]);

  if (!user) return null;
  const radio = user.role === 'RADIOLOGUE';
  const admin = user.role === 'ADMIN';
  const medecin = user.role === 'MEDECIN';

  const accroche = admin
    ? 'Gérez les accès à MedVision et suivez l’activité du service.'
    : radio
      ? stats ? (stats.aValider ? `${pluriel(stats.aValider, 'compte rendu attend', 'comptes rendus attendent')} votre validation.` : 'Aucun compte rendu en attente. Tout est à jour.') : ' '
      : 'Retrouvez ici les comptes rendus validés des examens que vous avez prescrits.';

  return (
    <>
      <section className="bandeau">
        <div>
          <p className="bandeau-date">{new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar', weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{salutation()}, {admin ? user.prenom : `Dr ${user.nom}`}</h1>
          <p className="bandeau-sous">{accroche}</p>
        </div>
        <div className="ligne">
          {!medecin && <EtatIA />}
          {medecin && <Link href="/examens?statut=VALIDE" className="btn btn-principal"><Icone nom="check-cercle" />Voir les comptes rendus</Link>}
          {radio && !!stats?.aValider && <Link href="/examens?statut=A_VALIDER" className="btn btn-principal"><Icone nom="check-cercle" />Commencer la validation</Link>}
          {admin && <Link href="/admin/utilisateurs" className="btn btn-principal"><Icone nom="utilisateur-plus" />Gérer les comptes</Link>}
        </div>
      </section>

      <div className="stats">
        {medecin ? <>
          <CarteStat href="/examens?statut=VALIDE" icone="check-cercle" valeur={stats?.valides} libelle="comptes rendus disponibles" />
          <CarteStat href={`/examens?statut=${FILTRE_ATTENTE_MEDECIN}`} icone="horloge" teinte="bleu"
            valeur={stats ? stats.aValider + stats.enCours + stats.echecs : undefined} libelle="examens chez le radiologue" />
        </> : <>
          <CarteStat href="/examens?statut=A_VALIDER" icone="check-cercle" teinte="ambre" valeur={stats?.aValider} libelle="rapports à valider" />
          <CarteStat href="/examens?statut=ANALYSE_EN_COURS,EN_ATTENTE" icone="etincelle" teinte="bleu" valeur={stats?.enCours} libelle="analyses en cours" />
        </>}
        <CarteStat icone="calendrier" valeur={stats?.examensJour} libelle="examens aujourd’hui" />
        {admin
          ? <CarteStat href="/admin/utilisateurs" icone="bouclier" valeur={stats?.utilisateurs} libelle="comptes actifs" />
          : <CarteStat href="/patients" icone="patients" valeur={stats?.patients} libelle="patients enregistrés" />}
      </div>

      {stats && stats.echecs > 0 && radio && (
        <div style={{ marginBottom: 22 }}>
          <Alerte genre="erreur" action={<Link href="/examens?statut=ECHEC" className="btn btn-petit btn-danger"><Icone nom="rafraichir" />Voir et relancer</Link>}>
            <strong>{pluriel(stats.echecs, 'analyse a échoué', 'analyses ont échoué')}.</strong> Le plus souvent, le serveur IA était momentanément indisponible : il suffit de relancer.
          </Alerte>
        </div>
      )}

      {!admin && (
        <section className="panneau">
          <div className="panneau-titre">
            <h2>{radio ? 'Votre liste de travail' : 'Examens récents'}</h2>
            <Link href="/examens" className="btn btn-fantome btn-petit">Tout voir<Icone nom="chevron-droite" /></Link>
          </div>
          {examens === null ? <SqueletteTableau lignes={4} /> : examens.length === 0 ? (
            radio
              ? <EtatVide icone="check-cercle" titre="Tout est à jour">Aucun compte rendu n’attend votre validation. Les nouveaux examens apparaîtront ici dès leur analyse terminée.</EtatVide>
              : <EtatVide icone="examens" titre="Aucun examen pour le moment">
                  Dès que le service d’imagerie aura enregistré un examen que vous avez prescrit, il apparaîtra ici avec son statut.
                </EtatVide>
          ) : <ListeExamens examens={examens.slice(0, 10)} />}
        </section>
      )}

      {admin && (
        <div className="raccourcis">
          <Link href="/admin/utilisateurs" className="raccourci">
            <span className="stat-icone"><Icone nom="bouclier" taille={20} /></span>
            <div><h3>Comptes</h3><p>Créez les comptes des médecins et radiologues, réinitialisez un mot de passe ou désactivez un accès.</p></div>
          </Link>
          <Link href="/admin/journal" className="raccourci">
            <span className="stat-icone"><Icone nom="journal" taille={20} /></span>
            <div><h3>Journal d’activité</h3><p>Chaque connexion, consultation et validation est tracée et ne peut pas être modifiée.</p></div>
          </Link>
        </div>
      )}
    </>
  );
}
