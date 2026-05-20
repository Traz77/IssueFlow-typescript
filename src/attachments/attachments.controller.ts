import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { AttachmentsService } from './attachments.service';
import { AttachmentCreateResponseDto, AttachmentResponseDto } from './dto/attachment-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];

@Controller()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('tickets/:ticketId/attachments')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, _file, cb) => cb(null, randomUUID()),
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
        cb(
          new BadRequestException(
            `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_TYPES.join(', ')}`,
          ),
          false,
        );
      },
    }),
  )
  create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<AttachmentCreateResponseDto> {
    if (!file) throw new BadRequestException('File is required');
    return this.attachmentsService.create(ticketId, file, user.sub);
  }

  @Get('tickets/:ticketId/attachments')
  listByTicket(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<AttachmentResponseDto[]> {
    return this.attachmentsService.listByTicket(ticketId);
  }

  @Delete('tickets/:ticketId/attachments/:attachmentId')
  @HttpCode(200)
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.attachmentsService.remove(ticketId, attachmentId, user.sub);
  }
}
