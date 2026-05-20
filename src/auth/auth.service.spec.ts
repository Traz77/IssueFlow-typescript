import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';

jest.mock('bcrypt');

const mockUsersService = {
  findByUsernameWithPassword: jest.fn(),
  findOne: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
};

const makeUserEntity = (overrides: Partial<User> = {}): User =>
  ({
    id: 1,
    username: 'jdoe',
    email: 'jdoe@example.com',
    fullName: 'John Doe',
    role: UserRole.DEVELOPER,
    passwordHash: '$2b$10$hashedpassword',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as User;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('validateUser()', () => {
    it('returns a UserResponseDto on correct credentials', async () => {
      mockUsersService.findByUsernameWithPassword.mockResolvedValue(makeUserEntity());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('jdoe', 'password123');

      expect(result).toBeDefined();
      expect(result.username).toBe('jdoe');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws UnauthorizedException("Invalid credentials") on wrong password', async () => {
      mockUsersService.findByUsernameWithPassword.mockResolvedValue(makeUserEntity());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.validateUser('jdoe', 'wrong')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('throws UnauthorizedException("Invalid credentials") when user not found', async () => {
      mockUsersService.findByUsernameWithPassword.mockResolvedValue(null);

      await expect(service.validateUser('nobody', 'pass')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });
  });

  describe('login()', () => {
    it('returns { accessToken, tokenType: "Bearer", expiresIn: number }', async () => {
      const user = { id: 1, username: 'jdoe', email: 'jdoe@example.com', fullName: 'John Doe', role: UserRole.DEVELOPER };

      const result = await service.login(user as never);

      expect(result.accessToken).toBeDefined();
      expect(result.tokenType).toBe('Bearer');
      expect(typeof result.expiresIn).toBe('number');
      expect(result.expiresIn).toBe(3600);
    });
  });

  describe('logout() / isDenied()', () => {
    it('isDenied returns false before logout', () => {
      expect(service.isDenied('some-jti')).toBe(false);
    });

    it('isDenied returns true after logout with the same jti', () => {
      const jti = 'test-jti-abc';
      const exp = Math.floor(Date.now() / 1000) + 3600;

      service.logout(jti, exp);

      expect(service.isDenied(jti)).toBe(true);
    });
  });
});
