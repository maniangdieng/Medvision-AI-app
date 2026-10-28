import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Exam } from './exam.entity';
import { User } from './user.entity';

@Entity('rapports')
export class Report {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @OneToOne(() => Exam, (e) => e.rapport, { onDelete: 'CASCADE' }) @JoinColumn() examen!: Exam;
  /** Texte brut produit par MedGemma (conservé pour traçabilité) */
  @Column({ type: 'text' }) texteIA!: string;
  /** Texte relu et corrigé par le radiologue */
  @Column({ type: 'text' }) texteFinal!: string;
  /** Détections BioMedCLIP — contexte interne, jamais affiché dans le rapport */
  @Column({ type: 'jsonb', nullable: true, select: false }) detectionsInternes?: unknown;
  @Column({ default: 0 }) nbImagesAnalysees!: number;
  @Column({ nullable: true }) modele?: string;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: true }) validePar?: User | null;
  @Column({ type: 'timestamptz', nullable: true }) valideLe?: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) creeLe!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) modifieLe!: Date;
}
