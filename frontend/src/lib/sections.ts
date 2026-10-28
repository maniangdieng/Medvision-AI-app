const SECTIONS = [
  "TYPE D'EXAMEN", 'INDICATION CLINIQUE', 'TECHNIQUE', 'OBSERVATIONS GLOBALES', 'OBSERVATIONS',
  'ANOMALIES DÉTECTÉES', 'ANOMALIES DETECTEES', 'ANOMALIES', 'IMPRESSION DIAGNOSTIQUE', 'IMPRESSION', 'RECOMMANDATIONS',
];

/** Couleur d'une rubrique, identique à celle du PDF. */
export type Genre = 'neutre' | 'contexte' | 'anomalie' | 'rassurant' | 'conclusion' | 'conseil';
export type Rubrique = { numero?: number; titre: string; contenu: string; genre: Genre };

/** Découpe le texte RSNA en sections brutes (même règle que le PDF côté serveur). */
function decouper(texte: string): [string, string][] {
  const out: [string, string][] = [];
  let courant: string | null = null;
  let buf: string[] = [];
  const pousser = () => { if (courant && buf.join('').trim()) out.push([courant, buf.join('\n').trim()]); };
  for (const brute of texte.split('\n')) {
    const l = brute.trim();
    if (!l) continue;
    const propre = l.replace(/\*+/g, '').trim();
    const avant = propre.split(':')[0].trim().toUpperCase();
    const titre = avant.length < 60 ? SECTIONS.find((m) => avant.startsWith(m)) : undefined;
    if (titre) {
      pousser(); courant = titre; buf = [];
      const reste = propre.includes(':') ? propre.slice(propre.indexOf(':') + 1).trim() : '';
      if (reste.length > 2) buf.push(reste);
    } else if (!l.startsWith('#')) {
      if (!courant) courant = 'COMPTE RENDU';
      buf.push(propre.replace(/^[-•]\s*/, '• '));
    }
  }
  pousser();
  return out;
}

const rienASignaler = (t: string) => /^(•\s*)?(aucun|aucune|pas d|absence d|néant|rien)/i.test(t.trim());

/**
 * Rubriques dans un ordre fixe, comme dans le PDF : contexte (non numéroté) puis
 * 1 Observations, 2 Anomalies, 3 Conclusion, 4 Recommandations. Une rubrique absente reste affichée vide.
 */
export function sections(texte: string): Rubrique[] {
  const g = { type: '', indication: '', technique: '', observations: '', anomalies: '', conclusion: '', recommandations: '' };
  const ajouter = (cle: keyof typeof g, t: string) => { g[cle] = g[cle] ? `${g[cle]}\n${t}` : t; };
  for (const [titre, contenu] of decouper(texte)) {
    if (titre === "TYPE D'EXAMEN") ajouter('type', contenu);
    else if (titre === 'INDICATION CLINIQUE') ajouter('indication', contenu);
    else if (titre === 'TECHNIQUE') ajouter('technique', contenu);
    else if (titre.startsWith('ANOMALIES')) ajouter('anomalies', contenu);
    else if (titre.startsWith('IMPRESSION')) ajouter('conclusion', contenu);
    else if (titre === 'RECOMMANDATIONS') ajouter('recommandations', contenu);
    else ajouter('observations', contenu);
  }
  const contexte: Rubrique[] = [
    { titre: 'Type d’examen', contenu: g.type, genre: 'contexte' as const },
    { titre: 'Indication clinique', contenu: g.indication, genre: 'contexte' as const },
    { titre: 'Technique', contenu: g.technique, genre: 'contexte' as const },
  ].filter((r) => r.contenu);
  return [
    ...contexte,
    { numero: 1, titre: 'Observations', contenu: g.observations, genre: 'neutre' },
    { numero: 2, titre: 'Anomalies détectées', contenu: g.anomalies, genre: g.anomalies && rienASignaler(g.anomalies) ? 'rassurant' : 'anomalie' },
    { numero: 3, titre: 'Conclusion', contenu: g.conclusion, genre: 'conclusion' },
    { numero: 4, titre: 'Recommandations', contenu: g.recommandations, genre: 'conseil' },
  ];
}
