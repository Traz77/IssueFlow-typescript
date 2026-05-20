import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class ImportTicketsDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  projectId: number;
}
