import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectResponseDto } from './dto/project-response.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('projects')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class ProjectsAdminController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('deleted')
  findDeleted(): Promise<ProjectResponseDto[]> {
    return this.projectsService.findDeleted();
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  restore(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.projectsService.restore(projectId, user.sub);
  }
}
