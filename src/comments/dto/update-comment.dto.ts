import { IsInt, IsPositive, IsString, Length } from 'class-validator';

export class UpdateCommentDto {
  @IsString()
  @Length(1, 5000)
  content: string;

  @IsInt()
  @IsPositive()
  version: number;
}
