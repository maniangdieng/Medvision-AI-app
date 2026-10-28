'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner } from './ui';

/** Indique si le serveur IA répond : les médecins savent tout de suite si l'analyse est possible. */
export function EtatIA() {
  const [etat, setEtat] = useState<boolean | null>(null);
  useEffect(() => {
    let vivant = true;
    const verifier = () => api<{ disponible: boolean }>('/ai/status')
      .then((r) => vivant && setEtat(r.disponible)).catch(() => vivant && setEtat(false));
    verifier();
    const t = setInterval(verifier, 60_000);
    return () => { vivant = false; clearInterval(t); };
  }, []);
  const classe = etat === null ? 'verif' : etat ? 'ok' : 'ko';
  const texte = etat === null ? 'Vérification de l’IA…' : etat ? 'IA disponible' : 'IA hors ligne';
  return (
    <span className={`ia-etat ia-${classe}`} role="status"
      title={etat === false ? 'Le serveur IA ne répond pas : les nouvelles analyses échoueront. Prévenez l’administrateur.' : undefined}>
      {etat === null ? <Spinner taille={12} /> : <span className="point" />}
      {texte}
    </span>
  );
}
