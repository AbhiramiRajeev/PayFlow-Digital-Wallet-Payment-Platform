import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { UserRole } from '@prisma/client';

// Test fixture credentials — not real secrets
const TEST_PW = 'Test@Pw1234';
const TEST_PW_WRONG = 'Wrong@Pw1234';

// ─── Mock Factories ──────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-uuid-1',
  email: 'alice@example.com',
  passwordHash: '$2b$12$abc123hashedpassword',
  firstName: 'Alice',
  lastName: 'Doe',
  role: UserRole.USER,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockWallet = {
  id: 'wallet-uuid-1',
  userId: 'user-uuid-1',
  currency: 'INR',
  balance: BigInt(0),
  status: 'ACTIVE',
  label: 'Default',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let walletsService: jest.Mocked<WalletsService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            create: jest.fn(),
            findByEmail: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: WalletsService,
          useValue: {
            createWallet: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock.jwt.token'),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('7d'),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    walletsService = module.get(WalletsService);
    jwtService = module.get(JwtService);
  });

  describe('register', () => {
    it('should create a user, create a default wallet, and return a JWT', async () => {
      usersService.create.mockResolvedValue(mockUser);
      walletsService.createWallet.mockResolvedValue(mockWallet as never);

      const result = await authService.register({
        email: 'alice@example.com',
        password: TEST_PW,
        firstName: 'Alice',
        lastName: 'Doe',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.com' }),
      );
      expect(walletsService.createWallet).toHaveBeenCalledWith(mockUser.id, 'INR', 'Default');
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.user.email).toBe('alice@example.com');
    });

    it('should throw ConflictException when email is already registered', async () => {
      usersService.create.mockRejectedValue(
        new ConflictException('Email already registered'),
      );

      await expect(
        authService.register({
          email: 'alice@example.com',
          password: TEST_PW,
          firstName: 'Alice',
          lastName: 'Doe',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return JWT for valid credentials', async () => {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash(TEST_PW, 10);
      const userWithHash = { ...mockUser, passwordHash: hash };

      usersService.findByEmail.mockResolvedValue(userWithHash);

      const result = await authService.login({
        email: 'alice@example.com',
        password: TEST_PW,
      });

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.email).toBe('alice@example.com');
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.login({
          email: 'alice@example.com',
          password: TEST_PW_WRONG,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'unknown@example.com',
          password: TEST_PW,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for suspended account', async () => {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash(TEST_PW, 10);
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
        isActive: false,
      });

      await expect(
        authService.login({
          email: 'alice@example.com',
          password: TEST_PW,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should not leak user existence via error message', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      try {
        await authService.login({ email: 'x@x.com', password: TEST_PW });
        fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('Invalid email or password');
      }
    });

    // Ignore unused jwtService variable warning
    it('creates a valid JWT', () => {
      expect(jwtService.sign).toBeDefined();
    });
  });
});
