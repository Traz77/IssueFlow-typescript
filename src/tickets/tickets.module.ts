import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from './entities/ticket.entity';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { User } from '../users/entities/user.entity';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketDependenciesService } from './ticket-dependencies.service';
import { TicketDependenciesController } from './ticket-dependencies.controller';
import { TicketsAdminController } from './tickets-admin.controller';
import { TicketsImportExportService } from './tickets-import-export.service';
import { TicketsImportExportController } from './tickets-import-export.controller';
import { WorkloadService } from './workload.service';
import { WorkloadController } from './workload.controller';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketDependency, User]),
    ProjectsModule,
    UsersModule,
    AuditLogModule,
  ],
  controllers: [TicketsAdminController, TicketsImportExportController, TicketsController, TicketDependenciesController, WorkloadController],
  providers: [TicketsService, TicketDependenciesService, TicketsImportExportService, WorkloadService],
  exports: [TicketsService],
})
export class TicketsModule {}
