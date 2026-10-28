import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

/** Jeton de rafraîchissement (stocké haché, rotation à chaque usage). */
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true }) utilisateur!: User;
  @Index({ unique: true }) @Column() tokenHash!: string;
  @Column({ type: 'timestamptz' }) expireLe!: Date;
  @Column({ type: 'timestamptz', nullable: true }) revoqueLe?: Date | null;
  @Column({ nullable: true }) ip?: string;
  @Column({ nullable: true }) userAgent?: string;
  @CreateDateColumn({ type: 'timestamptz' }) creeLe!: Date;
}
