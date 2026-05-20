import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { WorkloadEntry, WorkloadService } from './workload.service';

@Controller()
export class WorkloadController {
  constructor(private readonly workloadService: WorkloadService) {}

  @Get('projects/:projectId/workload')
  getProjectWorkload(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<WorkloadEntry[]> {
    return this.workloadService.getProjectWorkload(projectId);
  }
}
