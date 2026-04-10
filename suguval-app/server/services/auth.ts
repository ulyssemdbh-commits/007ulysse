/**
 * Auth Service — Standalone SUGUVal.
 * Simplified auth. Replace with your own authentication system.
 */
export const authService = {
  async getUserById(id: number): Promise<{ id: number; username: string; role: string } | null> {
    return { id, username: "admin", role: "admin" };
  },

  async validateSession(token: string): Promise<{ userId: number } | null> {
    if (!token) return null;
    return { userId: 1 };
  },
};
