import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { EnvironmentVariables } from '../config/env.validation';
import { ADMIN_TOKEN_SUBJECT, AdminTokenPayload } from './admin.constants';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly jwtService: JwtService,
  ) {}

  // Returns a signed access token, or throws the same 401 for a wrong email
  // or a wrong password so the response doesn't reveal which one failed.
  async login(email: string, password: string): Promise<string> {
    const adminEmail = this.config.get('ADMIN_EMAIL', { infer: true });
    const passwordHash = this.config.get('ADMIN_PASSWORD_HASH', {
      infer: true,
    });

    // bcrypt runs even when the email is wrong, so response time doesn't
    // reveal whether the email was correct.
    const passwordMatches = await compare(password, passwordHash);
    const emailMatches = email.toLowerCase() === adminEmail.toLowerCase();

    if (!emailMatches || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: AdminTokenPayload = { sub: ADMIN_TOKEN_SUBJECT };
    return this.jwtService.signAsync(payload);
  }

  getAdminEmail(): string {
    return this.config.get('ADMIN_EMAIL', { infer: true });
  }
}
