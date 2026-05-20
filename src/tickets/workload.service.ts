import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from './entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

export interface WorkloadEntry {
  userId: number;
  username: string;
  openTicketCount: number;
}

@Injectable()
export class WorkloadService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  getProjectWorkload(projectId: number): Promise<WorkloadEntry[]> {
    return this.userRepo
      .createQueryBuilder('u')
      .select('u.id', 'userId')
      .addSelect('u.username', 'username')
      .addSelect('COUNT(t.id)', 'openTicketCount')
      .leftJoin(
        'tickets',
        't',
        "t.assignee_id = u.id AND t.project_id = :projectId AND t.status != 'DONE' AND t.deleted_at IS NULL",
        { projectId },
      )
      .where('u.role = :role', { role: UserRole.DEVELOPER })
      .andWhere(
        `(
          EXISTS (
            SELECT 1 FROM projects p
            WHERE p.owner_id = u.id AND p.id = :projectId AND p.deleted_at IS NULL
          )
          OR
          EXISTS (
            SELECT 1 FROM tickets t2
            WHERE t2.assignee_id = u.id AND t2.project_id = :projectId AND t2.deleted_at IS NULL
          )
        )`,
        { projectId },
      )
      .groupBy('u.id')
      .addGroupBy('u.username')
      .addGroupBy('u.created_at')
      .orderBy('"openTicketCount"', 'ASC')
      .addOrderBy('u.created_at', 'ASC')
      .getRawMany()
      .then(
        (
          rows: Array<{
            userId: string;
            username: string;
            openTicketCount: string;
          }>,
        ) =>
          rows.map((r) => ({
            userId: Number(r.userId),
            username: r.username,
            openTicketCount: parseInt(r.openTicketCount, 10),
          })),
      );
  }

  async pickAutoAssignee(projectId: number): Promise<number | null> {
    const workload = await this.getProjectWorkload(projectId);
    return workload.length > 0 ? workload[0].userId : null;
  }
}
