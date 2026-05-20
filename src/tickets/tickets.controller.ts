import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  findAllByProject(
    @Query('projectId', ParseIntPipe) projectId: number,
  ): Promise<TicketResponseDto[]> {
    return this.ticketsService.findAllByProject(projectId);
  }

  @Get(':ticketId')
  findOne(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.findOne(ticketId);
  }

  @Post()
  @HttpCode(200)
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.create(dto, user.sub);
  }

  @Patch(':ticketId')
  @HttpCode(200)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.ticketsService.update(ticketId, dto, user.sub);
  }

  @Delete(':ticketId')
  @HttpCode(200)
  softDelete(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.ticketsService.softDelete(ticketId, user.sub);
  }
}
