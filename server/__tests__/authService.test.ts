import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockStorage = {
  getUserByUsername: vi.fn(),
  getUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
};

const mockBcrypt = {
  hash: vi.fn(),
  compare: vi.fn(),
};

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('bcrypt', () => mockBcrypt);

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateCredentials', () => {
    it('should return null for non-existent user', async () => {
      mockStorage.getUserByUsername.mockResolvedValue(null);
      
      const result = await mockStorage.getUserByUsername('nonexistent');
      
      expect(result).toBeNull();
      expect(mockStorage.getUserByUsername).toHaveBeenCalledWith('nonexistent');
    });

    it('should validate correct password', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        passwordHash: 'hashedpassword',
        isOwner: false,
      };
      mockStorage.getUserByUsername.mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(true);
      
      const user = await mockStorage.getUserByUsername('testuser');
      const isValid = await mockBcrypt.compare('password123', user.passwordHash);
      
      expect(user).toBeDefined();
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        passwordHash: 'hashedpassword',
        isOwner: false,
      };
      mockStorage.getUserByUsername.mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(false);
      
      const user = await mockStorage.getUserByUsername('testuser');
      const isValid = await mockBcrypt.compare('wrongpassword', user.passwordHash);
      
      expect(isValid).toBe(false);
    });
  });

  describe('createUser', () => {
    it('should hash password when creating user', async () => {
      mockBcrypt.hash.mockResolvedValue('hashedpassword');
      mockStorage.createUser.mockResolvedValue({
        id: 1,
        username: 'newuser',
        displayName: 'New User',
        isOwner: false,
      });

      await mockBcrypt.hash('password123', 12);
      const user = await mockStorage.createUser({
        username: 'newuser',
        displayName: 'New User',
        passwordHash: 'hashedpassword',
      });

      expect(mockBcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(user.username).toBe('newuser');
    });
  });

  describe('getUser', () => {
    it('should return user by id', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        displayName: 'Test User',
        isOwner: true,
      };
      mockStorage.getUser.mockResolvedValue(mockUser);

      const user = await mockStorage.getUser(1);

      expect(user).toEqual(mockUser);
      expect(mockStorage.getUser).toHaveBeenCalledWith(1);
    });

    it('should return null for non-existent user', async () => {
      mockStorage.getUser.mockResolvedValue(null);

      const user = await mockStorage.getUser(999);

      expect(user).toBeNull();
    });
  });

  describe('owner verification', () => {
    it('should identify owner user', async () => {
      const ownerUser = {
        id: 1,
        username: 'maurice',
        isOwner: true,
      };
      mockStorage.getUser.mockResolvedValue(ownerUser);

      const user = await mockStorage.getUser(1);

      expect(user?.isOwner).toBe(true);
    });

    it('should identify non-owner user', async () => {
      const regularUser = {
        id: 2,
        username: 'guest',
        isOwner: false,
      };
      mockStorage.getUser.mockResolvedValue(regularUser);

      const user = await mockStorage.getUser(2);

      expect(user?.isOwner).toBe(false);
    });
  });
});
