import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Ticket } from '../../tickets/entities/ticket.entity';
import { User } from '../../users/entities/user.entity';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'ticket_id' })
  ticketId: number;

  @ManyToOne(() => Ticket, { eager: false })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ length: 255 })
  filename: string;

  @Column({ name: 'stored_name', length: 64 })
  storedName: string;

  @Column({ name: 'content_type', length: 100 })
  contentType: string;

  @Column({
    type: 'bigint',
    transformer: { to: (v: number) => v, from: (v: string) => parseInt(v, 10) },
  })
  size: number;

  @Column({ name: 'uploaded_by_id' })
  uploadedById: number;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
