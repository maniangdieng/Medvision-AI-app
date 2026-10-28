'use client';
import { useEffect, useState } from 'react';
import type { Statut } from '@/lib/types';
import { Icone } from './Icone';
import { Spinner } from './ui';

/*
 * Le serveur IA ne publie pas son avancement : les étapes sont estimées d'après le temps écoulé.
 * La dernière n'est jamais cochée ici, c'est l'arrivée du compte rendu qui la termine.
 */
const ETAPES = [
  { texte: 'Images reçues et vérifiées', fin: 0 },
  { texte: 'Démarrage du moteur IA', fin: 25 },
  { texte: 'Lecture des images par MedGemma', fin: 100 },
  { texte: 'Rédaction du compte rendu', fin: Infinity },
];

function chrono(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function AnalyseIA({ statut, depuis, nbImages }: { statut: Statut; depuis: string; nbImages: number }) {
  const [ecoule, setEcoule] = useState(0);
  useEffect(() => {
    const t0 = new Date(depuis).getTime();
    const maj = () => setEcoule(Math.max(0, Math.floor((Date.now() - t0) / 1000)));
    maj();
    const t = setInterval(maj, 1000);
    return () => clearInterval(t);
  }, [depuis]);

  const attente = statut === 'EN_ATTENTE';
  const courante = attente ? 1 : ETAPES.findIndex((e) => ecoule < e.fin);

  return (
    <section className="analyse" aria-live="polite" aria-busy="true">
      <div className="analyse-tete">
        <span className="analyse-orbe"><Icone nom="etincelle" taille={22} /></span>
        <div>
          <h2>{attente ? 'En file d’attente' : 'Analyse par l’IA en cours'}</h2>
          <p>{nbImages} fichier{nbImages > 1 ? 's' : ''} · cette page se met à jour toute seule</p>
        </div>
        <span className="analyse-chrono" aria-label={`Temps écoulé : ${chrono(ecoule)}`}>{chrono(ecoule)}</span>
      </div>

      <ol className="etapes">
        {ETAPES.map((e, i) => {
          const etat = i < courante ? 'faite' : i === courante ? 'active' : '';
          return (
            <li key={e.texte} className={`etape ${etat}`}>
              <span className="etape-marque">
                {etat === 'faite' ? <Icone nom="check" taille={13} /> : etat === 'active' ? <Spinner taille={13} /> : null}
              </span>
              {attente && i === 1 ? 'En attente de la fin de l’analyse précédente' : e.texte}
            </li>
          );
        })}
      </ol>

      <div className="barre-indeterminee" />
      <p className="analyse-note">
        {ecoule > 240
          ? 'L’analyse prend plus de temps que d’habitude (images nombreuses ou serveur IA très sollicité). Elle se poursuit, vous pouvez quitter cette page.'
          : 'La première analyse de la journée est plus longue : le serveur IA démarre à la demande. Vous pouvez quitter cette page, le compte rendu vous attendra.'}
      </p>
    </section>
  );
}
