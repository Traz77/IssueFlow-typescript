import { User } from '../../users/entities/user.entity';

export class MentionedUserDto {
  id: number;
  username: string;
  fullName: string;

  static from(user: User): MentionedUserDto {
    const dto = new MentionedUserDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.fullName = user.fullName;
    return dto;
  }
}
