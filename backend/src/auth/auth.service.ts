import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { verifierPolitiqueMotDePasse } from '../common/password';
import { Session, User } from '../entities';

const MAX_TENTATIVES = 5;
const VERROUILLAGE_MIN = 15;
const REFRESH_JOURS = 7;
// hash factice : le temps de réponse est le même que l'email existe ou non
const HASH_FACTICE = bcrypt.hashSync('compte-inexistant', 12);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Tokens { accessToken: string; refreshToken: string; user: User }

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, motDePasse: string, ip: string, ua: string): Promise<Tokens> {
    const mail = email.trim().toLowerCase();
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash')
      .where('u.email = :mail', { mail }).getOne();

    const echec = new UnauthorizedException('Email ou mot de passe incorrect');
    if (!user) {
      await bcrypt.compare(motDePasse, HASH_FACTICE);
      await this.audit.log('CONNEXION_ECHEC', { email: mail, ip, details: 'compte inconnu' });
      throw echec;
    }
    if (user.verrouilleJusqua && user.verrouilleJusqua > new Date()) {
      await this.audit.log('CONNEXION_REFUSEE_VERROU', { user, ip });
      throw new UnauthorizedException(
        `Compte temporairement verrouillé après plusieurs échecs. Réessayez après ${user.verrouilleJusqua.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Dakar', hour: '2-digit', minute: '2-digit' })}.`,
      );
    }
    const ok = await bcrypt.compare(motDePasse, user.passwordHash);
    if (!ok || !user.actif) {
      const n = user.tentativesEchouees + 1;
      await this.users.update(user.id, {
        tentativesEchouees: n >= MAX_TENTATIVES ? 0 : n,
        verrouilleJusqua: n >= MAX_TENTATIVES ? new Date(Date.now() + VERROUILLAGE_MIN * 60_000) : user.verrouilleJusqua,
      });
      await this.audit.log(n >= MAX_TENTATIVES ? 'COMPTE_VERROUILLE' : 'CONNEXION_ECHEC', { user, ip });
      throw echec;
    }

    await this.users.update(user.id, { tentativesEchouees: 0, verrouilleJusqua: null, derniereConnexion: new Date() });
    await this.audit.log('CONNEXION', { user, ip });
    return this.emettre(user, ip, ua);
  }

  /** Rotation : l'ancien jeton est révoqué, un nouveau est émis. Réutilisation détectée = toutes les sessions révoquées. */
  async refresh(refreshToken: string | undefined, ip: string, ua: string): Promise<Tokens> {
    if (!refreshToken) throw new UnauthorizedException('Session expirée');
    const session = await this.sessions.findOne({ where: { tokenHash: sha256(refreshToken) } });
    if (!session || session.expireLe < new Date() || !session.utilisateur.actif) {
      throw new UnauthorizedException('Session expirée');
    }
    if (session.revoqueLe) {
      await this.sessions.update({ utilisateur: { id: session.utilisateur.id }, revoqueLe: IsNull() }, { revoqueLe: new Date() });
      await this.audit.log('REUTILISATION_JETON', { user: session.utilisateur, ip });
      throw new UnauthorizedException('Session expirée');
    }
    await this.sessions.update(session.id, { revoqueLe: new Date() });
    return this.emettre(session.utilisateur, ip, ua);
  }

  async logout(refreshToken: string | undefined, ip?: string): Promise<void> {
    if (!refreshToken) return;
    const session = await this.sessions.findOne({ where: { tokenHash: sha256(refreshToken) } });
    if (!session) return;
    await this.sessions.update(session.id, { revoqueLe: new Date() });
    await this.audit.log('DECONNEXION', { user: session.utilisateur, ip });
  }

  async changerMotDePasse(user: User, ancien: string, nouveau: string, ip: string): Promise<void> {
    const u = await this.users.createQueryBuilder('u').addSelect('u.passwordHash')
      .where('u.id = :id', { id: user.id }).getOneOrFail();
    if (!(await bcrypt.compare(ancien, u.passwordHash))) {
      throw new BadRequestException('Ancien mot de passe incorrect');
    }
    if (ancien === nouveau) throw new BadRequestException('Le nouveau mot de passe doit être différent');
    verifierPolitiqueMotDePasse(nouveau);
    await this.users.update(user.id, { passwordHash: await bcrypt.hash(nouveau, 12), doitChangerMotDePasse: false });
    // déconnecte les autres appareils
    await this.sessions.update({ utilisateur: { id: user.id }, revoqueLe: IsNull() }, { revoqueLe: new Date() });
    await this.audit.log('MOT_DE_PASSE_CHANGE', { user, ip });
  }

  async emettre(user: User, ip: string, ua: string): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.sessions.insert({
      utilisateur: { id: user.id },
      tokenHash: sha256(refreshToken),
      expireLe: new Date(Date.now() + REFRESH_JOURS * 86_400_000),
      ip,
      userAgent: ua?.slice(0, 250),
    });
    const fresh = await this.users.findOneByOrFail({ id: user.id });
    return { accessToken, refreshToken, user: fresh };
  }
}
