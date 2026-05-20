import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('tickets')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class TicketsAdminController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('deleted')
  findDeletedByProject(
    @Query('projectId', ParseIntPipe) projectId: number,
  ): Promise<TicketResponseDto[]> {
    return this.ticketsService.findDeletedByProject(projectId);
  }

  @Post(':ticketId/restore')
  @HttpCode(200)
  restore(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.ticketsService.restore(ticketId, user.sub);
  }
}
