import request from "request";
import querystring from "querystring";
import { endpoints } from "./constants";
import {
  AttributeError,
  ConnectionError,
  MediaTypeError,
  NotFoundError,
  OtherError,
  ServerError
} from "./exception";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type PathParams = Record<string, string | number>;
export type QueryParams = Record<string, string | number | boolean>;

export interface ApiServiceState {
  accessToken: string | null;
  publicAccessToken: string | null;
  readAccessToken: string | null;
  apiCall: (
    api: string,
    tokens: string[],
    httpMethod: HttpMethod,
    payload?: unknown | null,
    params?: QueryParams | null,
    pathParam?: PathParams | null
  ) => Promise<string>;
}

const validateToken = (
  tokens: string[],
  accessToken: string | null,
  publicAccessToken: string | null,
  readAccessToken: string | null
): string | null => {
  let jwtToken: string | null = null;

  if (accessToken && tokens.includes("access_token")) {
    jwtToken = accessToken;
  }
  if (publicAccessToken && tokens.includes("public_access_token")) {
    jwtToken = publicAccessToken;
  }
  if (readAccessToken && tokens.includes("read_access_token")) {
    jwtToken = readAccessToken;
  }
  if (tokens.length > 0 && jwtToken === null) {
    throw new NotFoundError("Token is invalid");
  }
  return jwtToken;
};

export const apiService: ApiServiceState = {
  accessToken: null,
  publicAccessToken: null,
  readAccessToken: null,
  apiCall(api, tokens, httpMethod, payload = null, params = null, pathParam = null) {
    const requestBody = payload === null ? undefined : JSON.stringify(payload);
    const queryParam = params ? querystring.stringify(params) : "";
    let url = `${endpoints.host}${api}`;

    if (pathParam) {
      Object.keys(pathParam).forEach((key) => {
        url = url.replace(`{${key}}`, String(pathParam[key]));
      });
    }

    if (params) {
      url = `${url}?${queryParam}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "openapi-client-src": "sdk"
    };

    const jwtToken = validateToken(tokens, this.accessToken, this.publicAccessToken, this.readAccessToken);
    if (jwtToken) {
      headers["x-jwt-token"] = jwtToken;
    }

    const options: request.Options = {
      headers,
      url,
      method: httpMethod
    };

    if (requestBody !== undefined) {
      options.body = requestBody;
    }

    return new Promise((resolve, reject) => {
      request(options, (error, response, body) => {
        if (body) {
          if (response.statusCode !== 200) {
            if (response.statusCode === 401) {
              throw new ConnectionError(body);
            } else if (response.statusCode === 400) {
              throw new AttributeError(body);
            } else if (response.statusCode === 404) {
              throw new NotFoundError(body);
            } else if (response.statusCode === 415) {
              throw new MediaTypeError(body);
            } else if (response.statusCode === 500) {
              throw new ServerError(body);
            } else {
              throw new OtherError(body);
            }
          }
          resolve(body);
        } else {
          reject(error);
        }
      });
    });
  }
};
