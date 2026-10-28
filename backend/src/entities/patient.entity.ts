import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Sexe } from './enums';
import { Exam } from './exam.entity';
import { User } from './user.entity';

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid') id!: string;
  /** Numéro de dossier hospitalier, ex. HPZ-2026-000123 */
  @Column({ unique: true }) numeroDossier!: string;
  @Column() prenom!: string;
  @Column() nom!: string;
  @Column({ type: 'date', nullable: true }) dateNaissance?: string | null;
  @Column({ type: 'enum', enum: Sexe, nullable: true }) sexe?: Sexe | null;
  @Column({ nullable: true }) telephone?: string;
  @Column({ nullable: true }) adresse?: string;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) creePar?: User | null;
  @OneToMany(() => Exam, (e) => e.patient) examens?: Exam[];
  @CreateDateColumn({ type: 'timestamptz' }) creeLe!: Date;
}
