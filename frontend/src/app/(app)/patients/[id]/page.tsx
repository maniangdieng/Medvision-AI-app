'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icone, NomIcone } from '@/components/Icone';
import { Statut } from '@/components/Statut';
import { Alerte, Avatar, EtatVide, Squelette, SqueletteTableau } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { age, date, dateHeure, libelleRegion } from '@/lib/format';
import type { Patient } from '@/lib/types';

function Info({ icone, titre, valeur }: { icone: NomIcone; titre: string; valeur: string }) {
  return <div><Icone nom={icone} /><div><dt>{titre}</dt><dd>{valeur}</dd></div></div>;
}

export default function FichePatient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const radio = useAuth().user?.role === 'RADIOLOGUE';
  const [p, setP] = useState<Patient | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => { api<Patient>(`/patients/${id}`).then(setP).catch((e) => setErreur(e.message)); }, [id]);

  if (erreur) return <Alerte genre="erreur">{erreur}</Alerte>;

  return (
    <>
      <div className="fil"><Link href="/patients">Patients</Link><Icone nom="chevron-droite" taille={14} />{p ? `${p.nom} ${p.prenom}` : '…'}</div>
      <section className="panneau" style={{ marginBottom: 22 }}>
        <div className="fiche-patient">
          {p ? <Avatar prenom={p.prenom} nom={p.nom} taille={64} /> : <Squelette l={64} h={64} rond />}
          <div>
            {p ? <h1>{p.nom} {p.prenom}</h1> : <Squelette l={220} h={28} />}
            {p ? <span className="puce-dossier"><Icone nom="dossier" taille={13} />{p.numeroDossier}</span> : <div style={{ marginTop: 8 }}><Squelette l={110} /></div>}
          </div>
          {p && radio && <Link href={`/examens/nouveau?patient=${p.id}`} className="btn btn-principal"><Icone nom="plus" />Nouvel examen</Link>}
        </div>
        <dl className="fiche">
          <Info icone="horloge" titre="Âge" valeur={p ? age(p.dateNaissance) || '—' : '…'} />
          <Info icone="calendrier" titre="Date de naissance" valeur={p ? date(p.dateNaissance) : '…'} />
          <Info icone="patients" titre="Sexe" valeur={!p ? '…' : p.sexe === 'M' ? 'Masculin' : p.sexe === 'F' ? 'Féminin' : '—'} />
          <Info icone="telephone" titre="Téléphone" valeur={p ? p.telephone || '—' : '…'} />
        </dl>
      </section>

      <section className="panneau">
        <div className="panneau-titre"><h2>Examens d’imagerie</h2>{p?.examens?.length ? <span className="badge">{p.examens.length}</span> : null}</div>
        {!p ? <SqueletteTableau lignes={3} /> : !p.examens?.length ? (
          <EtatVide icone="examens" titre="Aucun examen pour ce patient"
            action={<Link href={`/examens/nouveau?patient=${p.id}`} className="btn btn-principal"><Icone nom="envoi" />Ajouter des images</Link>}>
            Déposez une radiographie, un scanner ou une IRM : l’IA rédigera un pré-rapport que vous relirez et validerez.
          </EtatVide>
        ) : (
          <div className="defile"><table className="tableau">
            <thead><tr><th>Date</th><th>Examen</th><th className="masquable">Prescrit par</th><th>Statut</th><th aria-hidden="true" /></tr></thead>
            <tbody>
              {p.examens.map((e) => (
                <tr key={e.id} className="cliquable" onClick={() => router.push(`/examens/${e.id}`)}>
                  <td><Link href={`/examens/${e.id}`} className="nom" onClick={(ev) => ev.stopPropagation()}>{dateHeure(e.creeLe)}</Link></td>
                  <td><span className="modalite">{e.modalite}</span><div className="discret">{libelleRegion(e.region)}</div></td>
                  <td className="masquable discret">{e.demandePar ? `Dr ${e.demandePar.nom}` : '—'}</td>
                  <td><Statut statut={e.statut} /></td>
                  <td className="fleche"><Icone nom="chevron-droite" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
