'use client';
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Icone } from './Icone';

type Genre = 'ok' | 'erreur' | 'info';
interface Toast { id: number; genre: Genre; texte: string }
type Afficher = (genre: Genre, texte: string) => void;

const ToastCtx = createContext<Afficher>(() => {});
const ICONE = { ok: 'check-cercle', erreur: 'alerte', info: 'info' } as const;

/** Notifications éphémères en bas d'écran, annoncées aux lecteurs d'écran. Usage : `toast('ok', 'Enregistré.')`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [liste, setListe] = useState<Toast[]>([]);
  const suivant = useRef(0);

  const retirer = useCallback((id: number) => setListe((l) => l.filter((t) => t.id !== id)), []);
  const afficher = useCallback<Afficher>((genre, texte) => {
    const id = ++suivant.current;
    setListe((l) => [...l.slice(-2), { id, genre, texte }]);
    setTimeout(() => retirer(id), genre === 'erreur' ? 8000 : 4500);
  }, [retirer]);

  return (
    <ToastCtx.Provider value={afficher}>
      {children}
      <div className="toasts" aria-live="polite">
        {liste.map((t) => (
          <div key={t.id} className={`toast toast-${t.genre}`}>
            <Icone nom={ICONE[t.genre]} taille={20} />
            <p>{t.texte}</p>
            <button onClick={() => retirer(t.id)} aria-label="Fermer la notification"><Icone nom="x" taille={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
