import type { PaytmTokenResponse } from "../types/paytm";

const PAYTM_HOST = "https://developer.paytmmoney.com";
const PAYTM_LOGIN = "https://login.paytmmoney.com/merchant-login?apiKey=";

export class PaytmHttpClient {
  constructor(
    private readonly apiKey: string | null,
    private readonly apiSecret: string | null,
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

    return this.fetchJson<PaytmTokenResponse>(
      `${PAYTM_HOST}/accounts/v2/gettoken`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          api_secret_key: this.apiSecret,
          request_token: requestToken,
        }),
      },
    );
  }

  async fetchSecurityMaster(fileName: string) {
    const response = await fetch(
      `${PAYTM_HOST}/data/v1/scrips/${encodeURIComponent(fileName)}`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to download security master ${fileName}: ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  async fetchLiveMarketData(
    jwtToken: string,
    mode: string,
    preferences: string[],
  ) {
    const url = `${PAYTM_HOST}/data/v1/price/live?mode=${encodeURIComponent(
      mode,
    )}&pref=${preferences.join(",")}`;

    return this.fetchJson<Record<string, unknown>>(url, {
      headers: {
        "x-jwt-token": jwtToken,
      },
    });
  }

  // Paytm serves bars newest-first by range: fromDate is the later day, toDate
  // the earlier one, at most 89 days apart. NSE only; MINUTE stops in Feb 2023.
  async fetchDailyChart(
    jwtToken: string,
    params: {
      symbol: string;
      series: string;
      fromDate: string;
      toDate: string;
    },
  ) {
    const response = await this.send(`${PAYTM_HOST}/data/v1/price-charts/sym`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jwt-token": jwtToken,
      },
      body: JSON.stringify({
        ...params,
        cont: "false",
        exchange: "NSE",
        expiry: null,
        instType: "ES",
        interval: "DAY",
        monthId: null,
        strike: null,
      }),
      signal: AbortSignal.timeout(8000),
    });

    // A well-formed request with no bars (holiday, unknown symbol, or dates
    // before listing) comes back as 405.
    if (response.status === 405) {
      return { data: [] } as Record<string, unknown>;
    }
    return this.readJson<Record<string, unknown>>(response);
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    return this.readJson<T>(await this.send(url, init));
  }

  private send(url: string, init?: RequestInit) {
    return fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "openapi-client-src": "mock-trader",
        ...(init?.headers ?? {}),
      },
    });
  }

  private async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Paytm request failed ${response.status} ${response.statusText}: ${body}`,
      );
    }

    return (await response.json()) as T;
  }
}
