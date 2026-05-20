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
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findAll(): Promise<ProjectResponseDto[]> {
    return this.projectsService.findAll();
  }

  @Get(':projectId')
  findOne(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(projectId);
  }

  @Post()
  @HttpCode(200)
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.create(dto, user.sub);
  }

  @Patch(':projectId')
  @HttpCode(200)
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.projectsService.update(projectId, dto, user.sub);
  }

  @Delete(':projectId')
  @HttpCode(200)
  softDelete(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.projectsService.softDelete(projectId, user.sub);
  }
}
