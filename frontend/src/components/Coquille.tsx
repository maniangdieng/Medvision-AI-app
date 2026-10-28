'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LIBELLE_ROLE } from '@/lib/format';
import { Croix } from './Croix';
import { Icone, NomIcone } from './Icone';
import { Avatar, EcranChargement } from './ui';

function Lien({ href, icone, children, compteur }: { href: string; icone: NomIcone; children: ReactNode; compteur?: number }) {
  const chemin = usePathname();
  const actif = href === '/' ? chemin === '/' : chemin.startsWith(href);
  return (
    <Link href={href} className={`nav-lien${actif ? ' actif' : ''}`} aria-current={actif ? 'page' : undefined}>
      <Icone nom={icone} />
      <span>{children}</span>
      {!!compteur && <span className="compteur" aria-label={`${compteur} en attente`}>{compteur}</span>}
    </Link>
  );
}

export function Coquille({ children }: { children: ReactNode }) {
  const { user, chargement, deconnecter } = useAuth();
  const router = useRouter();
  const chemin = usePathname();
  const [aValider, setAValider] = useState(0);

  useEffect(() => {
    if (chargement) return;
    if (!user) router.replace('/connexion');
    else if (user.doitChangerMotDePasse) router.replace('/mot-de-passe');
  }, [user, chargement, router]);

  useEffect(() => {
    if (!user || user.role === 'ADMIN' || user.doitChangerMotDePasse) return;
    api<{ aValider: number }>('/stats').then((s) => setAValider(s.aValider)).catch(() => {});
  }, [user, chemin]);

  if (chargement || !user || user.doitChangerMotDePasse) return <EcranChargement />;

  const clinique = user.role !== 'ADMIN';
  return (
    <div className="coquille">
      <nav className="laterale" aria-label="Navigation principale">
        <Link href="/" className="marque" aria-label="MedVision, tableau de bord">
          <span className="marque-croix"><Croix /></span>
          <div>
            <div className="marque-nom">MedVision</div>
            <div className="marque-lieu">Imagerie médicale</div>
          </div>
        </Link>
        <div className="nav-liens">
          <Lien href="/" icone="accueil">Tableau de bord</Lien>
          {clinique && <>
            <Lien href="/patients" icone="patients">Patients</Lien>
            <Lien href="/examens" icone="examens" compteur={user.role === 'RADIOLOGUE' ? aValider : undefined}>
              {user.role === 'RADIOLOGUE' ? 'Examens à valider' : 'Examens'}
            </Lien>
          </>}
          {user.role === 'ADMIN' && <>
            <div className="nav-section">Administration</div>
            <Lien href="/admin/utilisateurs" icone="bouclier">Comptes</Lien>
            <Lien href="/admin/journal" icone="journal">Journal d’activité</Lien>
          </>}
        </div>
        <div className="laterale-pied">
          <div className="profil">
            <Avatar prenom={user.prenom} nom={user.nom} taille={38} />
            <div>
              <div className="qui">{user.role === 'ADMIN' ? '' : 'Dr '}{user.prenom} {user.nom}</div>
              <div className="role">{LIBELLE_ROLE[user.role]}{user.service ? ` · ${user.service}` : ''}</div>
            </div>
          </div>
          <Lien href="/mot-de-passe" icone="cle">Changer mon mot de passe</Lien>
          <button className="nav-lien" onClick={deconnecter}><Icone nom="deconnexion" /><span>Se déconnecter</span></button>
        </div>
      </nav>
      {/* key : chaque page rejoue l'animation d'entrée */}
      <main className="contenu" key={chemin}>{children}</main>
    </div>
  );
}
