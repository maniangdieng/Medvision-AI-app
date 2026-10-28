import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Journal d'audit : qui a fait quoi, quand, depuis où. Jamais modifié. */
@Entity('journal_audit')
export class AuditLog {
  @PrimaryGeneratedColumn('increment') id!: number;
  @Index() @Column({ nullable: true }) utilisateurId?: string;
  @Column({ nullable: true }) utilisateurEmail?: string;
  @Index() @Column() action!: string;
  @Column({ nullable: true }) entite?: string;
  @Column({ nullable: true }) entiteId?: string;
  @Column({ type: 'text', nullable: true }) details?: string;
  @Column({ nullable: true }) ip?: string;
  @Index() @CreateDateColumn({ type: 'timestamptz' }) date!: Date;
}
