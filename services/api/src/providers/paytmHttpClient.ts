import type { PaytmTokenResponse } from "../types/paytm";

const PAYTM_HOST = "https://developer.paytmmoney.com";
const PAYTM_LOGIN = "https://login.paytmmoney.com/merchant-login?apiKey=";

export class PaytmHttpClient {
  constructor(
    private readonly apiKey: string | null,
    private readonly apiSecret: string | null
  ) {}

  getLoginUrl(state: string) {
    if (!this.apiKey) {
      throw new Error("PAYTM_API_KEY is not configured");
    }
    return `${PAYTM_LOGIN}${this.apiKey}&state=${state}`;
  }

  async generateSession(requestToken: string) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Paytm credentials are not configured");
    }

    return this.fetchJson<PaytmTokenResponse>(`${PAYTM_HOST}/accounts/v2/gettoken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        api_secret_key: this.apiSecret,
        request_token: requestToken,
      }),
    });
  }

  async fetchSecurityMaster(fileName: string) {
    const response = await fetch(
      `${PAYTM_HOST}/data/v1/scrips/${encodeURIComponent(fileName)}`
    );
    if (!response.ok) {
      throw new Error(
        `Failed to download security master ${fileName}: ${response.status} ${response.statusText}`
      );
    }
    return response.text();
  }

  async fetchLiveMarketData(jwtToken: string, mode: string, preferences: string[]) {
    const url = `${PAYTM_HOST}/data/v1/price/live?mode=${encodeURIComponent(
      mode
    )}&pref=${preferences.join(",")}`;

    return this.fetchJson<Record<string, unknown>>(url, {
      headers: {
        "x-jwt-token": jwtToken,
      },
    });
  }

  async fetchRawChart(jwtToken: string, params: Record<string, string>) {
    const url = new URL(`${PAYTM_HOST}/data/v1/price-charts/sym`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return this.fetchJson<Record<string, unknown>>(url.toString(), {
      headers: {
        "x-jwt-token": jwtToken,
      },
    });
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "openapi-client-src": "mock-trader",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Paytm request failed ${response.status} ${response.statusText}: ${body}`
      );
    }

    return (await response.json()) as T;
  }
}
