export interface PaytmSession {
  access_token: string;
  public_access_token: string;
  read_access_token: string;
  request_token: string;
  updated_at: string;
}

export interface PaytmTokenResponse {
  access_token?: string;
  public_access_token?: string;
  read_access_token?: string;
  request_token?: string;
  [key: string]: unknown;
}
