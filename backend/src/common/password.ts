import { BadRequestException } from '@nestjs/common';

/** Politique de mot de passe : 10 caractères, majuscule, minuscule, chiffre. */
export function verifierPolitiqueMotDePasse(mdp: string): void {
  const ok = mdp.length >= 10 && /[A-Z]/.test(mdp) && /[a-z]/.test(mdp) && /\d/.test(mdp);
  if (!ok) {
    throw new BadRequestException(
      'Le mot de passe doit contenir au moins 10 caractères, une majuscule, une minuscule et un chiffre.',
    );
  }
}
