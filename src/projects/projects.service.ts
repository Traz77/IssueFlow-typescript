import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectsRepo: Repository<Project>,
    private readonly usersService: UsersService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(): Promise<ProjectResponseDto[]> {
    const projects = await this.projectsRepo.find({
      where: { deletedAt: IsNull() },
    });
    return projects.map(ProjectResponseDto.from);
  }

  async findOne(id: number): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.findOneRaw(id));
  }

  async create(dto: CreateProjectDto, requesterSub: number): Promise<ProjectResponseDto> {
    try {
      await this.usersService.findOne(dto.ownerId);
    } catch {
      throw new BadRequestException('Owner user does not exist');
    }

    const project = this.projectsRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      ownerId: dto.ownerId,
    });
    const saved = await this.projectsRepo.save(project);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.PROJECT_CREATED,
      resourceType: AuditResourceType.PROJECT,
      resourceId: saved.id,
      metadata: { name: dto.name, ownerId: dto.ownerId },
    });

    return ProjectResponseDto.from(saved);
  }

  async update(id: number, dto: UpdateProjectDto, requesterSub: number): Promise<void> {
    const project = await this.findOneRaw(id);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    await this.projectsRepo.save(project);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.PROJECT_UPDATED,
      resourceType: AuditResourceType.PROJECT,
      resourceId: id,
      metadata: dto as unknown as Record<string, unknown>,
    });
  }

  async softDelete(id: number, requesterSub: number): Promise<void> {
    const project = await this.findOneRaw(id);
    project.deletedAt = new Date();
    await this.projectsRepo.save(project);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.PROJECT_DELETED,
      resourceType: AuditResourceType.PROJECT,
      resourceId: id,
    });
  }

  async findDeleted(): Promise<ProjectResponseDto[]> {
    const projects = await this.projectsRepo.find({
      where: { deletedAt: Not(IsNull()) },
    });
    return projects.map(ProjectResponseDto.from);
  }

  async restore(id: number, requesterSub: number): Promise<void> {
    const project = await this.projectsRepo.findOne({
      where: { id, deletedAt: Not(IsNull()) },
    });
    if (!project) throw new NotFoundException('Deleted project not found');

    project.deletedAt = null;
    await this.projectsRepo.save(project);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.PROJECT_RESTORED,
      resourceType: AuditResourceType.PROJECT,
      resourceId: id,
    });
  }

  private async findOneRaw(id: number): Promise<Project> {
    const project = await this.projectsRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!project) throw new NotFoundException(`Project #${id} not found`);
    return project;
  }
}
