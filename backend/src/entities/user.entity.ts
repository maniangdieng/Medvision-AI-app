import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Role } from './enums';

@Entity('utilisateurs')
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) email!: string;
  @Column({ select: false }) passwordHash!: string;
  @Column() prenom!: string;
  @Column() nom!: string;
  @Column({ type: 'enum', enum: Role }) role!: Role;
  @Column({ nullable: true }) service?: string;
  @Column({ default: true }) actif!: boolean;
  @Column({ default: true }) doitChangerMotDePasse!: boolean;
  @Column({ default: 0 }) tentativesEchouees!: number;
  @Column({ type: 'timestamptz', nullable: true }) verrouilleJusqua?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) derniereConnexion?: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) creeLe!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) modifieLe!: Date;
}
