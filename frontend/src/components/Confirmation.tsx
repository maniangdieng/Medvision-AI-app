'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icone } from './Icone';

export interface OptionsConfirmation {
  titre: string;
  message: ReactNode;
  /** Libellé du bouton de confirmation (« Confirmer » par défaut). */
  confirmer?: string;
  /** Action risquée ou irréversible : bouton rouge. */
  danger?: boolean;
}

type Confirmer = (options: OptionsConfirmation) => Promise<boolean>;
const ConfirmationCtx = createContext<Confirmer>(async () => false);

/**
 * Remplace window.confirm() par une fenêtre aux couleurs de l'application.
 * Usage : `if (!(await confirmer({ titre, message }))) return;`
 */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<OptionsConfirmation | null>(null);
  const resoudre = useRef<((ok: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const confirmer = useCallback<Confirmer>((o) => new Promise<boolean>((resolve) => {
    resoudre.current?.(false); // une demande précédente restée ouverte vaut « Annuler »
    resoudre.current = resolve;
    setOptions(o);
  }), []);

  useEffect(() => {
    const d = dialog.current;
    if (options && d && !d.open) d.showModal(); // modale native : Échap, fond assombri, focus gardé dans la fenêtre
  }, [options]);

  const fermer = (ok: boolean) => {
    resoudre.current?.(ok);
    resoudre.current = null;
    dialog.current?.close();
    setOptions(null);
  };

  return (
    <ConfirmationCtx.Provider value={confirmer}>
      {children}
      <dialog
        ref={dialog}
        className="confirmation"
        aria-labelledby="confirmation-titre"
        onCancel={(e) => { e.preventDefault(); fermer(false); }}
        onClick={(e) => { if (e.target === dialog.current) fermer(false); }}
      >
        {options && (
          <div className="confirmation-corps">
            <span className={`confirmation-icone${options.danger ? ' danger' : ''}`}><Icone nom={options.danger ? 'alerte' : 'info'} taille={22} /></span>
            <h2 id="confirmation-titre">{options.titre}</h2>
            <p>{options.message}</p>
            <div className="confirmation-actions">
              {/* « Annuler » en premier : c'est lui qui reçoit le focus, un Entrée réflexe ne valide rien */}
              <button type="button" className="btn" onClick={() => fermer(false)}>Annuler</button>
              <button type="button" className={`btn ${options.danger ? 'btn-danger' : 'btn-principal'}`} onClick={() => fermer(true)}>
                {options.confirmer ?? 'Confirmer'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmationCtx.Provider>
  );
}

export const useConfirmation = () => useContext(ConfirmationCtx);
