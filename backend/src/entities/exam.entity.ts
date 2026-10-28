import {
  Column, CreateDateColumn, Entity, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { ExamStatus } from './enums';
import { ExamImage } from './exam-image.entity';
import { Patient } from './patient.entity';
import { Report } from './report.entity';
import { User } from './user.entity';

@Entity('examens')
export class Exam {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Patient, (p) => p.examens, { onDelete: 'CASCADE' }) patient!: Patient;
  /** Région anatomique : thorax, cerveau, abdomen, os, général */
  @Column() region!: string;
  /** Radiographie, IRM, Scanner, Échographie */
  @Column() modalite!: string;
  @Column({ type: 'text', nullable: true }) indication?: string | null;
  @Column({ type: 'text', nullable: true }) question?: string | null;
  @Column({ type: 'enum', enum: ExamStatus, default: ExamStatus.EN_ATTENTE }) statut!: ExamStatus;
  @Column({ type: 'text', nullable: true }) erreur?: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) demandePar?: User | null;
  @OneToMany(() => ExamImage, (i) => i.examen, { cascade: true }) images?: ExamImage[];
  @OneToOne(() => Report, (r) => r.examen) rapport?: Report | null;
  @CreateDateColumn({ type: 'timestamptz' }) creeLe!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) modifieLe!: Date;
}
