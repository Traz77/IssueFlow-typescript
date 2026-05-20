import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';

jest.mock('bcrypt');

const mockRepository = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) };

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 1,
    username: 'jdoe',
    email: 'jdoe@example.com',
    fullName: 'John Doe',
    role: UserRole.DEVELOPER,
    passwordHash: 'hashed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as User;

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepository },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    mockAuditLog.log.mockResolvedValue(undefined);
  });

  describe('create()', () => {
    const dto = {
      username: 'jdoe',
      email: 'jdoe@example.com',
      fullName: 'John Doe',
      role: UserRole.DEVELOPER,
      password: 'password123',
    };

    it('hashes the password and never stores the plaintext', async () => {
      const fakeHash = '$2b$10$fakehashedvalue';
      (bcrypt.hash as jest.Mock).mockResolvedValue(fakeHash);

      const entityToSave = { ...dto, passwordHash: fakeHash };
      mockRepository.create.mockReturnValue(entityToSave);
      mockRepository.save.mockResolvedValue(makeUser({ passwordHash: fakeHash }));

      await service.create(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      const persistedArg = mockRepository.save.mock.calls[0][0];
      expect(persistedArg.passwordHash).toBe(fakeHash);
      expect(persistedArg.passwordHash).not.toBe('password123');
    });

    it('throws ConflictException on duplicate username or email', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      mockRepository.create.mockReturnValue({});
      mockRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('calls audit.log after successful create (self-action actorId = new user id)', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      const saved = makeUser({ id: 5 });
      mockRepository.create.mockReturnValue(saved);
      mockRepository.save.mockResolvedValue(saved);

      await service.create(dto);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 5, resourceId: 5 }),
      );
    });
  });

  describe('findOne()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll()', () => {
    it('never includes passwordHash in the response objects', async () => {
      mockRepository.find.mockResolvedValue([makeUser({ passwordHash: 'secret' })]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('passwordHash');
    });
  });
});
