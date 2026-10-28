import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomInt } from 'crypto';
import { Request } from 'express';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { clientIp, CurrentUser, Roles } from '../common/decorators';
import { verifierPolitiqueMotDePasse } from '../common/password';
import { Role, Session, User } from '../entities';
import { MailService } from '../mail/mail.service';

class CreateUserDto {
  @IsEmail() @MaxLength(160) email!: string;
  @IsString() @MinLength(2) @MaxLength(80) prenom!: string;
  @IsString() @MinLength(2) @MaxLength(80) nom!: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() @IsString() @MaxLength(80) service?: string;
}

class UpdateUserDto {
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) prenom?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) nom?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() @MaxLength(80) service?: string;
  @IsOptional() @IsBoolean() actif?: boolean;
}

class SetPasswordDto {
  @IsString() @MinLength(10) @MaxLength(200) motDePasse!: string;
  /** true (par défaut) : la personne devra en choisir un autre à la prochaine connexion. */
  @IsOptional() @IsBoolean() doitChanger?: boolean;
}

/** Mot de passe provisoire lisible, conforme à la politique (12 caractères). */
function motDePasseProvisoire(): string {
  const maj = 'ABCDEFGHJKLMNPQRSTUVWXYZ', min = 'abcdefghijkmnopqrstuvwxyz', chif = '23456789';
  const tous = maj + min + chif;
  const c = [maj[randomInt(maj.length)], min[randomInt(min.length)], chif[randomInt(chif.length)]];
  while (c.length < 12) c.push(tous[randomInt(tous.length)]);
  for (let i = c.length - 1; i > 0; i--) { const j = randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}

@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Get()
  liste() {
    return this.users.find({ order: { nom: 'ASC' } });
  }

  @Post()
  async creer(@Body() dto: CreateUserDto, @CurrentUser() admin: User, @Req() req: Request) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.exist({ where: { email } })) throw new ConflictException('Cet email est déjà utilisé');
    const mdp = motDePasseProvisoire();
    const u = await this.users.save(this.users.create({
      ...dto, email, passwordHash: await bcrypt.hash(mdp, 12), doitChangerMotDePasse: true,
    }));
    const emailEnvoye = await this.mail.envoyerMotDePasseProvisoire(u, mdp, 'creation');
    await this.audit.log('UTILISATEUR_CREE', { user: admin, entite: 'utilisateur', entiteId: u.id,
      details: `${email} (${dto.role})${emailEnvoye ? ' · mot de passe envoyé par e-mail' : ''}`, ip: clientIp(req) });
    const { passwordHash: _, ...sans } = u;
    // envoyé par e-mail : l'administrateur ne le voit jamais ; sinon il lui est montré une seule fois
    return emailEnvoye ? { utilisateur: sans, emailEnvoye } : { utilisateur: sans, emailEnvoye, motDePasseProvisoire: mdp };
  }

  @Patch(':id')
  async modifier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() admin: User, @Req() req: Request) {
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException();
    if (id === admin.id && (dto.actif === false || (dto.role && dto.role !== Role.ADMIN))) {
      throw new BadRequestException('Vous ne pouvez pas désactiver ou rétrograder votre propre compte');
    }
    if (dto.email !== undefined) {
      dto.email = dto.email.trim().toLowerCase();
      if (dto.email !== u.email && (await this.users.exist({ where: { email: dto.email } }))) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
    }
    await this.users.update(id, dto);
    await this.audit.log('UTILISATEUR_MODIFIE', { user: admin, entite: 'utilisateur', entiteId: id, details: JSON.stringify(dto), ip: clientIp(req) });
    return this.users.findOneBy({ id });
  }

  @Post(':id/reset-password')
  async reinitialiser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User, @Req() req: Request) {
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException();
    const mdp = motDePasseProvisoire();
    await this.users.update(id, { passwordHash: await bcrypt.hash(mdp, 12), doitChangerMotDePasse: true, tentativesEchouees: 0, verrouilleJusqua: null });
    await this.revoquerSessions(id);
    const emailEnvoye = await this.mail.envoyerMotDePasseProvisoire(u, mdp, 'reinitialisation');
    await this.audit.log('MOT_DE_PASSE_REINITIALISE', { user: admin, entite: 'utilisateur', entiteId: id,
      details: `${u.email}${emailEnvoye ? ' · envoyé par e-mail' : ''}`, ip: clientIp(req) });
    return emailEnvoye ? { emailEnvoye } : { emailEnvoye, motDePasseProvisoire: mdp };
  }

  /** L'administrateur choisit lui-même le mot de passe (par exemple au téléphone avec la personne). */
  @Put(':id/password')
  async definirMotDePasse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPasswordDto, @CurrentUser() admin: User, @Req() req: Request) {
    if (id === admin.id) throw new BadRequestException('Pour votre propre compte, utilisez « Changer mon mot de passe » (l’ancien mot de passe est demandé)');
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException();
    verifierPolitiqueMotDePasse(dto.motDePasse);
    const doitChanger = dto.doitChanger ?? true;
    await this.users.update(id, {
      passwordHash: await bcrypt.hash(dto.motDePasse, 12), doitChangerMotDePasse: doitChanger, tentativesEchouees: 0, verrouilleJusqua: null,
    });
    await this.revoquerSessions(id);
    await this.audit.log('MOT_DE_PASSE_DEFINI_PAR_ADMIN', { user: admin, entite: 'utilisateur', entiteId: id,
      details: `${u.email}${doitChanger ? ' · changement exigé' : ''}`, ip: clientIp(req) });
    return { ok: true };
  }

  /** Déconnecte la personne de tous ses appareils : l'ancien mot de passe ne doit plus donner accès. */
  private revoquerSessions(userId: string) {
    return this.sessions.update({ utilisateur: { id: userId }, revoqueLe: IsNull() }, { revoqueLe: new Date() });
  }
}
