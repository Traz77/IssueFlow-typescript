import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { TicketsImportExportService, ImportResult } from './tickets-import-export.service';
import { ImportTicketsDto } from './dto/import-tickets.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

const ALLOWED_CSV_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/csv',
  'text/plain',
];

@Controller('tickets')
export class TicketsImportExportController {
  constructor(private readonly importExportService: TicketsImportExportService) {}

  @Get('export')
  async exportProject(
    @Query('projectId', ParseIntPipe) projectId: number,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.importExportService.exportProject(projectId);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="tickets-project-${projectId}.csv"`);
    res.send(csv);
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_CSV_TYPES.includes(file.mimetype)) return cb(null, true);
        cb(
          new BadRequestException(
            `Unsupported file type for import: ${file.mimetype}`,
          ),
          false,
        );
      },
    }),
  )
  importProject(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ImportTicketsDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ImportResult> {
    if (!file) throw new BadRequestException('File is required');
    return this.importExportService.importProject(body.projectId, file.buffer, user.sub);
  }
}
