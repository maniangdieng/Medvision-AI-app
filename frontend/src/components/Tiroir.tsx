'use client';
import { ReactNode, useEffect, useRef } from 'react';
import { Icone } from './Icone';

interface Props { ouvert: boolean; titre: string; sousTitre?: string; onFermer: () => void; children: ReactNode }

/** Panneau qui glisse depuis la droite (formulaires d'administration). Modale native : Échap et clic sur le fond ferment. */
export function Tiroir({ ouvert, titre, sousTitre, onFermer, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ouvert && !d.open) d.showModal();
    if (!ouvert && d.open) d.close();
  }, [ouvert]);

  return (
    <dialog
      ref={ref}
      className="tiroir"
      aria-labelledby="tiroir-titre"
      onCancel={(e) => { e.preventDefault(); onFermer(); }}
      onClick={(e) => { if (e.target === ref.current) onFermer(); }}
    >
      {ouvert && (
        <div className="tiroir-contenu">
          <header className="tiroir-tete">
            <div>
              <h2 id="tiroir-titre">{titre}</h2>
              {sousTitre && <p>{sousTitre}</p>}
            </div>
            <button type="button" className="btn btn-fantome btn-icone" onClick={onFermer} aria-label="Fermer"><Icone nom="x" /></button>
          </header>
          <div className="tiroir-corps">{children}</div>
        </div>
      )}
    </dialog>
  );
}
