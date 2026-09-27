import { auth } from "../lib/auth";

export interface AuthenticatedUser {
  id: string;
  role?: string | null;
  banned?: boolean | null;
  tradingStatus?: string | null;
}

export interface AuthenticatedSession {
  id: string;
}

export interface AuthSessionResult {
  user: AuthenticatedUser;
  session: AuthenticatedSession;
}

export interface AuthSessionService {
  getSession(request: Request): Promise<AuthSessionResult | null>;
}

export class BetterAuthSessionService implements AuthSessionService {
  async getSession(request: Request) {
    return auth.api.getSession({
      headers: request.headers,
    });
  }
}

export const betterAuthSessionService = new BetterAuthSessionService();
