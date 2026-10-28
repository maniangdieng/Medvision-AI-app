export function Croix({ taille = 18, couleur = '#fff' }: { taille?: number; couleur?: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill={couleur} />
    </svg>
  );
}
