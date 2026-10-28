/**
 * Crée le premier compte administrateur.
 *   npm run build && npm run seed
 * Utilise ADMIN_EMAIL / ADMIN_PASSWORD du .env. L'administrateur devra
 * changer ce mot de passe à sa première connexion.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ENTITIES, Role, User } from './entities';

config();

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const mdp = process.env.ADMIN_PASSWORD || '';
  if (!email || mdp.length < 10) throw new Error('Définir ADMIN_EMAIL et ADMIN_PASSWORD (10 caractères min.) dans .env');

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities: ENTITIES,
    synchronize: true,
  });
  await ds.initialize();
  const repo = ds.getRepository(User);
  if (await repo.exist({ where: { email } })) {
    console.log(`Le compte ${email} existe déjà — rien à faire.`);
  } else {
    await repo.save(repo.create({
      email, prenom: 'Administrateur', nom: 'SYSTÈME', role: Role.ADMIN,
      passwordHash: await bcrypt.hash(mdp, 12), doitChangerMotDePasse: true,
    }));
    console.log(`Administrateur créé : ${email} (changement de mot de passe exigé à la 1re connexion)`);
  }
  await ds.destroy();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
