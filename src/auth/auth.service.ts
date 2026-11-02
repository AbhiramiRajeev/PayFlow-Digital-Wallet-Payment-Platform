import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { RegisterInput, LoginInput } from './auth.input';
import { AuthPayload } from './auth.model';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Register a new user.
   * 1. Hash the password using bcrypt (12 rounds).
   * 2. Create the user record.
   * 3. Automatically provision a default wallet.
   * 4. Return a signed JWT.
   */
  async register(input: RegisterInput): Promise<AuthPayload> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const user = await this.usersService.create({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
    });

    // Automatically create a default wallet for the new user
    await this.walletsService.createWallet(user.id, 'INR', 'Default');

    this.logger.log(`User registered: ${user.id}`);
    return this.buildAuthPayload(user);
  }

  /**
   * Authenticate a user with email/password.
   * Uses bcrypt.compare to avoid timing attacks.
   */
  async login(input: LoginInput): Promise<AuthPayload> {
    const user = await this.usersService.findByEmail(input.email);

    if (!user) {
      // Use same error message to prevent email enumeration
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is suspended');
    }

    this.logger.log(`User logged in: ${user.id}`);
    return this.buildAuthPayload(user);
  }

  private buildAuthPayload(user: User): AuthPayload {
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '7d');

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }
}
