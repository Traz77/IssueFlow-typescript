import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EscalationService } from './escalation.service';
import { EscalationController } from './escalation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket]), AuditLogModule],
  providers: [EscalationService],
  controllers: [EscalationController],
})
export class EscalationModule {}
