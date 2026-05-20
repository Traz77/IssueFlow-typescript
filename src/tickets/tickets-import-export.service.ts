import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Ticket } from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketsService } from './tickets.service';
import { ProjectsService } from '../projects/projects.service';

const CSV_COLUMNS = ['id', 'title', 'description', 'status', 'priority', 'type', 'assigneeId'];

export interface ImportResult {
  created: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

@Injectable()
export class TicketsImportExportService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketsRepo: Repository<Ticket>,
    private readonly projectsService: ProjectsService,
    private readonly ticketsService: TicketsService,
  ) {}

  async exportProject(projectId: number): Promise<string> {
    await this.projectsService.findOne(projectId);

    const tickets = await this.ticketsRepo.find({
      where: { projectId, deletedAt: IsNull() },
    });

    return stringify(tickets, {
      header: true,
      columns: CSV_COLUMNS,
    });
  }

  async importProject(
    projectId: number,
    csvBuffer: Buffer,
    requesterSub: number,
  ): Promise<ImportResult> {
    await this.projectsService.findOne(projectId);

    const rows: Record<string, string>[] = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let created = 0;
    let failed = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // header = row 1; data rows start at row 2
      const row = rows[i];

      const dto = plainToInstance(CreateTicketDto, {
        title: row.title || undefined,
        description: row.description || undefined,
        status: row.status || undefined,
        priority: row.priority || undefined,
        type: row.type || undefined,
        projectId,
        assigneeId: row.assigneeId ? parseInt(row.assigneeId, 10) : undefined,
        dueDate: row.dueDate || undefined,
      });

      const violations = await validate(dto, { whitelist: true });
      if (violations.length > 0) {
        const firstMessage =
          Object.values(violations[0].constraints ?? {})[0] ?? 'Validation failed';
        errors.push({ row: rowNumber, error: firstMessage });
        failed++;
        continue;
      }

      try {
        await this.ticketsService.create(dto, requesterSub);
        created++;
      } catch (err) {
        const error = err as Error;
        errors.push({ row: rowNumber, error: error.message });
        failed++;
      }
    }

    return { created, failed, errors };
  }
}
