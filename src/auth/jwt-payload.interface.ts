import { UserRole } from '../common/enums/user-role.enum';

export interface JwtPayload {
  sub: number;
  username: string;
  role: UserRole;
  jti: string;
  iat?: number;
  exp?: number;
}
