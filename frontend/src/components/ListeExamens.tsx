'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { dateHeure, libelleRegion } from '@/lib/format';
import type { Examen } from '@/lib/types';
import { Icone } from './Icone';
import { Statut } from './Statut';
import { Avatar } from './ui';

/** Tableau d'examens partagé par le tableau de bord et la liste des examens. Toute la ligne est cliquable. */
export function ListeExamens({ examens, demandeur }: { examens: Examen[]; demandeur?: boolean }) {
  const router = useRouter();
  return (
    <div className="defile"><table className="tableau">
      <thead><tr><th>Patient</th><th>Examen</th><th className="masquable">Demandé le</th><th>Statut</th><th aria-hidden="true" /></tr></thead>
      <tbody>
        {examens.map((e) => (
          <tr key={e.id} className="cliquable" onClick={() => router.push(`/examens/${e.id}`)}>
            <td>
              <div className="personne">
                <Avatar prenom={e.patient.prenom} nom={e.patient.nom} />
                <div>
                  <Link href={`/examens/${e.id}`} className="nom" onClick={(ev) => ev.stopPropagation()}>{e.patient.nom} {e.patient.prenom}</Link>
                  <div className="discret dossier">{e.patient.numeroDossier}</div>
                </div>
              </div>
            </td>
            <td><span className="modalite">{e.modalite}</span><div className="discret">{libelleRegion(e.region)}</div></td>
            <td className="masquable discret">{dateHeure(e.creeLe)}{demandeur && e.demandePar ? <div>Dr {e.demandePar.nom}</div> : null}</td>
            <td><Statut statut={e.statut} /></td>
            <td className="fleche"><Icone nom="chevron-droite" /></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}
