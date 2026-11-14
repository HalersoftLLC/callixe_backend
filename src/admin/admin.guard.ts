import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ADMIN_TOKEN_SUBJECT, AdminTokenPayload } from './admin.constants';

// Protects admin routes. Applied with @UseGuards(AdminGuard), never globally,
// so public storefront routes are unaffected.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException();
    }

    // Secret and allowed algorithm (HS256) come from JwtModule in AdminModule.
    // Any failure (bad signature, expired, malformed) is the same 401.
    let payload: AdminTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminTokenPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    if (payload.sub !== ADMIN_TOKEN_SUBJECT) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : undefined;
}
