import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  ParseIntPipe,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TicketDependenciesService } from './ticket-dependencies.service';
import { AddDependencyDto } from './dto/add-dependency.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('tickets/:ticketId/dependencies')
export class TicketDependenciesController {
  constructor(private readonly depsService: TicketDependenciesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async addDependency(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: AddDependencyDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.depsService.addDependency(ticketId, dto.blockedBy, user.sub);
  }

  @Get()
  async listDependencies(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<TicketResponseDto[]> {
    const blockers = await this.depsService.listDependencies(ticketId);
    return blockers.map(TicketResponseDto.from);
  }

  @Delete(':blockerId')
  @HttpCode(HttpStatus.OK)
  async removeDependency(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('blockerId', ParseIntPipe) blockerId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.depsService.removeDependency(ticketId, blockerId, user.sub);
  }
}
