'use client';
import { ButtonHTMLAttributes, CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { Croix } from './Croix';
import { Icone, NomIcone } from './Icone';

/** Indicateur de chargement circulaire ; prend la couleur du texte qui l'entoure. */
export function Spinner({ taille = 16, label }: { taille?: number; label?: string }) {
  return (
    <svg className="spinner" width={taille} height={taille} viewBox="0 0 24 24" fill="none"
      role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" opacity=".2" />
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="18 60" />
    </svg>
  );
}

interface PropsBouton extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Affiche un spinner à la place de l'icône et bloque les doubles clics. */
  chargement?: boolean;
  icone?: NomIcone;
}

export function Bouton({ chargement, icone, children, disabled, className = 'btn', ...reste }: PropsBouton) {
  return (
    <button className={className} disabled={disabled || chargement} aria-busy={chargement || undefined} {...reste}>
      {chargement ? <Spinner /> : icone && <Icone nom={icone} />}
      {children}
    </button>
  );
}

export function Squelette({ l = '100%', h = 14, rond }: { l?: number | string; h?: number; rond?: boolean }) {
  return <span className="squelette" style={{ width: l, height: h, borderRadius: rond ? '50%' : undefined }} />;
}

/** Silhouette d'un tableau pendant son chargement : la page garde sa forme, rien ne saute à l'arrivée des données. */
export function SqueletteTableau({ lignes = 5, colonnes = 4 }: { lignes?: number; colonnes?: number }) {
  return (
    <div className="squelette-tableau" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="squelette-ligne" style={{ gridTemplateColumns: `1.6fr repeat(${colonnes - 1}, 1fr)` }}>
          <span className="ligne" style={{ flexWrap: 'nowrap' }}>
            <Squelette l={34} h={34} rond />
            <span className="pile" style={{ gap: 6, flex: 1 }}><Squelette l="70%" /><Squelette l="40%" h={10} /></span>
          </span>
          {Array.from({ length: colonnes - 1 }, (_, j) => <Squelette key={j} l={`${45 + ((i * 7 + j * 13) % 40)}%`} />)}
        </div>
      ))}
    </div>
  );
}

export function EtatVide({ icone, titre, children, action }: { icone: NomIcone; titre: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="vide">
      <span className="vide-icone"><Icone nom={icone} taille={26} /></span>
      <h3>{titre}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const ICONE_ALERTE = { erreur: 'alerte', info: 'info', ok: 'check-cercle', ambre: 'horloge' } as const;

export function Alerte({ genre, children, action }: { genre: keyof typeof ICONE_ALERTE; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alerte alerte-${genre}`} role={genre === 'erreur' ? 'alert' : 'status'}>
      <Icone nom={ICONE_ALERTE[genre]} />
      <div className="alerte-texte">{children}</div>
      {action && <div className="alerte-action">{action}</div>}
    </div>
  );
}

/** Initiales sur une pastille de couleur stable (la même personne garde toujours la même teinte). */
export function Avatar({ prenom, nom, taille = 36 }: { prenom: string; nom: string; taille?: number }) {
  let teinte = 0;
  for (const c of prenom + nom) teinte = (teinte * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ '--t': `${taille}px`, '--h': teinte } as CSSProperties} aria-hidden="true">
      {`${prenom[0] ?? ''}${nom[0] ?? ''}`.toUpperCase()}
    </span>
  );
}

/** Nombre qui défile jusqu'à sa valeur (désactivé si l'utilisateur limite les animations). */
export function ChiffreAnime({ valeur }: { valeur: number }) {
  const [affiche, setAffiche] = useState(0);
  const depart = useRef(0);
  useEffect(() => {
    const de = depart.current;
    depart.current = valeur;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setAffiche(valeur); return; }
    const t0 = performance.now();
    let raf = 0;
    const pas = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setAffiche(Math.round(de + (valeur - de) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
  }, [valeur]);
  return <>{affiche}</>;
}

export function EcranChargement() {
  return (
    <div className="ecran-chargement" role="status" aria-label="Chargement de MedVision">
      <span className="marque-croix grand"><Croix taille={26} /></span>
      <Spinner taille={22} />
    </div>
  );
}
