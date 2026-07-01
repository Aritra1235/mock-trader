import { loadSession, saveSession } from "../lib/sessionStore";
import { PaytmHttpClient } from "../providers/paytmHttpClient";

export class PaytmSessionService {
  constructor(
    private readonly client: PaytmHttpClient,
    private readonly sessionPath: string
  ) {}

  getLoginUrl(state: string) {
    return this.client.getLoginUrl(state);
  }

  async getSession() {
    return loadSession(this.sessionPath);
  }

  async createSession(requestToken: string) {
    const response = await this.client.generateSession(requestToken);

    if (
      !response.access_token ||
      !response.public_access_token ||
      !response.read_access_token
    ) {
      throw new Error("Incomplete token payload returned by Paytm");
    }

    return saveSession(this.sessionPath, {
      access_token: response.access_token,
      public_access_token: response.public_access_token,
      read_access_token: response.read_access_token,
      request_token: requestToken,
    });
  }

  async requireReadableToken() {
    const session = await this.getSession();
    if (!session?.read_access_token && !session?.access_token) {
      throw new Error("Paytm session is not initialized");
    }
    return session.read_access_token || session.access_token;
  }

  async requirePublicToken() {
    const session = await this.getSession();
    if (!session?.public_access_token) {
      throw new Error("Paytm public access token is not initialized");
    }
    return session.public_access_token;
  }

  async getStatus() {
    const session = await this.getSession();
    return {
      authenticated: Boolean(session),
      updatedAt: session?.updated_at ?? null,
      hasPublicToken: Boolean(session?.public_access_token),
      hasReadToken: Boolean(session?.read_access_token),
    };
  }
}
