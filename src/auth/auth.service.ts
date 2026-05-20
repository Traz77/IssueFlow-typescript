import { Injectable, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { JwtPayload } from './jwt-payload.interface';

interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  // jti -> expiry (unix seconds); evicted every 60s to keep memory bounded
  private readonly denyList = new Map<string, number>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async validateUser(username: string, password: string): Promise<UserResponseDto> {
    const user = await this.usersService.findByUsernameWithPassword(username);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException('Invalid credentials');

    return UserResponseDto.from(user);
  }

  async login(user: UserResponseDto): Promise<LoginResponse> {
    const jti = randomUUID();
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      username: user.username,
      role: user.role,
      jti,
    };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken, tokenType: 'Bearer', expiresIn: 3600 };
  }

  logout(jti: string, exp: number): void {
    this.denyList.set(jti, exp);
  }

  isDenied(jti: string): boolean {
    return this.denyList.has(jti);
  }

  async getProfile(userId: number): Promise<UserResponseDto> {
    return this.usersService.findOne(userId);
  }

  private evictExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.denyList.entries()) {
      if (exp < now) this.denyList.delete(jti);
    }
  }
}
