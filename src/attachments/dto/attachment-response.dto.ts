import { Attachment } from '../entities/attachment.entity';

export class AttachmentCreateResponseDto {
  id: number;
  ticketId: number;
  filename: string;
  contentType: string;

  static fromCreate(a: Attachment): AttachmentCreateResponseDto {
    return { id: a.id, ticketId: a.ticketId, filename: a.filename, contentType: a.contentType };
  }
}

export class AttachmentResponseDto extends AttachmentCreateResponseDto {
  size: number;
  uploadedById: number;
  createdAt: Date;

  static from(a: Attachment): AttachmentResponseDto {
    return {
      id: a.id,
      ticketId: a.ticketId,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      uploadedById: a.uploadedById,
      createdAt: a.createdAt,
    };
  }
}
