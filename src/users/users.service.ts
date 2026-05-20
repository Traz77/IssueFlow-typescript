import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.usersRepo.find();
    return users.map(UserResponseDto.from);
  }

  async findOne(id: number): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.findOneEntity(id));
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({
      username: dto.username,
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      passwordHash,
    });

    let saved: User;
    try {
      saved = await this.usersRepo.save(user);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Username or email already exists');
      }
      throw err;
    }

    // Self-action: public signup has no requester, so actorId = the new user's own id
    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: saved.id,
      action: AuditAction.USER_CREATED,
      resourceType: AuditResourceType.USER,
      resourceId: saved.id,
      metadata: { username: saved.username, role: saved.role },
    });

    return UserResponseDto.from(saved);
  }

  async update(id: number, dto: UpdateUserDto, requesterSub: number): Promise<void> {
    const user = await this.findOneEntity(id);
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    await this.usersRepo.save(user);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.USER_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: id,
      metadata: dto as unknown as Record<string, unknown>,
    });
  }

  async remove(id: number, requesterSub: number): Promise<void> {
    await this.findOneEntity(id);
    await this.usersRepo.delete(id);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.USER_DELETED,
      resourceType: AuditResourceType.USER,
      resourceId: id,
    });
  }

  // Used by AuthService — explicitly selects the normally-hidden passwordHash column
  async findByUsernameWithPassword(username: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.username = :username', { username })
      .getOne();
  }

  private async findOneEntity(id: number): Promise<User> {
    const user = await this.usersRepo.findOneBy({ id });
    if (!user) throw new NotFoundException(`User #${id} not found`);
    return user;
  }
}
