import * as path from 'path';
import * as fs from 'fs/promises';
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from './entities/attachment.entity';
import { AttachmentCreateResponseDto, AttachmentResponseDto } from './dto/attachment-response.dto';
import { TicketsService } from '../tickets/tickets.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';

@Injectable()
export class AttachmentsService implements OnModuleInit {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentsRepo: Repository<Attachment>,
    private readonly ticketsService: TicketsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    await fs.mkdir('./uploads', { recursive: true });
  }

  async create(
    ticketId: number,
    file: Express.Multer.File,
    requesterSub: number,
  ): Promise<AttachmentCreateResponseDto> {
    await this.ticketsService.findOne(ticketId);

    const safeName = path.basename(file.originalname).replace(/[\x00-\x1f]/g, '').slice(0, 255);

    const attachment = this.attachmentsRepo.create({
      ticketId,
      filename: safeName,
      storedName: file.filename,
      contentType: file.mimetype,
      size: file.size,
      uploadedById: requesterSub,
    });
    const saved = await this.attachmentsRepo.save(attachment);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.ATTACHMENT_ADDED,
      resourceType: AuditResourceType.ATTACHMENT,
      resourceId: saved.id,
      metadata: {
        ticketId,
        filename: safeName,
        contentType: file.mimetype,
        size: file.size,
      },
    });

    return AttachmentCreateResponseDto.fromCreate(saved);
  }

  async listByTicket(ticketId: number): Promise<AttachmentResponseDto[]> {
    await this.ticketsService.findOne(ticketId);
    const attachments = await this.attachmentsRepo.find({
      where: { ticketId },
      order: { createdAt: 'DESC' },
    });
    return attachments.map(AttachmentResponseDto.from);
  }

  async remove(ticketId: number, attachmentId: number, requesterSub: number): Promise<void> {
    await this.ticketsService.findOne(ticketId);

    const attachment = await this.attachmentsRepo.findOneBy({ id: attachmentId });
    if (!attachment) throw new NotFoundException(`Attachment #${attachmentId} not found`);

    if (attachment.ticketId !== ticketId) {
      throw new NotFoundException(`Attachment #${attachmentId} not found`);
    }

    const diskPath = path.join('./uploads', attachment.storedName);
    try {
      await fs.unlink(diskPath);
    } catch (err) {
      console.warn(`Could not delete attachment file ${diskPath}:`, err);
    }

    await this.attachmentsRepo.remove(attachment);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.ATTACHMENT_REMOVED,
      resourceType: AuditResourceType.ATTACHMENT,
      resourceId: attachmentId,
      metadata: {
        ticketId,
        filename: attachment.filename,
        contentType: attachment.contentType,
      },
    });
  }
}
