import { Project } from '../entities/project.entity';

export class ProjectResponseDto {
  id: number;
  name: string;
  description: string | null;
  ownerId: number;

  static from(project: Project): ProjectResponseDto {
    const dto = new ProjectResponseDto();
    dto.id = project.id;
    dto.name = project.name;
    dto.description = project.description;
    dto.ownerId = project.ownerId;
    return dto;
  }
}
