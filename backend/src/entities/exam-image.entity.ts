import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Exam } from './exam.entity';

@Entity('images_examen')
export class ExamImage {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Exam, (e) => e.images, { onDelete: 'CASCADE' }) examen!: Exam;
  @Column() nomOriginal!: string;
  /** Nom de stockage interne (uuid), jamais dérivé du nom envoyé */
  @Column({ select: false }) cheminStockage!: string;
  @Column() typeMime!: string;
  @Column() taille!: number;
  /** true si affichable dans le navigateur (png/jpg) */
  @Column({ default: false }) apercu!: boolean;
}
