'use client';
import { useState } from 'react';

interface Props {
  id: string;
  value: string;
  onChange: (valeur: string) => void;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
}

/** Champ mot de passe masqué par défaut, avec un œil pour afficher ce que l'on tape. */
export function ChampMotDePasse({ id, value, onChange, autoComplete, required }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mdp-champ">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
      />
      <button
        type="button"
        className="mdp-oeil"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        aria-pressed={visible}
        aria-controls={id}
        title={visible ? 'Masquer' : 'Afficher'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}
