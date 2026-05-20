import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { EscalationService, EscalationSummary } from './escalation.service';

@Controller('admin/escalation')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}

  @Post('run')
  @HttpCode(200)
  run(): Promise<EscalationSummary> {
    return this.escalationService.runEscalation();
  }
}
