import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  CreateDateColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

@Entity('ticket_dependencies')
@Unique(['ticketId', 'blockerId'])
export class TicketDependency {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  ticketId: number;

  @Index()
  @Column()
  blockerId: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockerId' })
  blocker: Ticket;

  @CreateDateColumn()
  createdAt: Date;
}
