import { apiService } from "./src/apiService";
import { endpoints } from "./src/constants";
import {
  AttributeError,
  ConnectionError,
  MediaTypeError,
  NotFoundError,
  OtherError,
  ServerError
} from "./src/exception";
import { PMClient } from "./src/pmClient";

describe("PMClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("exception types set names", () => {
    expect(new ConnectionError("error").name).toBe("ConnectionError");
    expect(new AttributeError("error").name).toBe("AttributeError");
    expect(new MediaTypeError("error").name).toBe("MediaTypeError");
    expect(new ServerError("error").name).toBe("ServerError");
    expect(new NotFoundError("error").name).toBe("NotFoundError");
    expect(new OtherError("error").name).toBe("OtherError");
  });

  test("constructor validations", () => {
    expect(() => new PMClient(null as unknown as string, null as unknown as string)).toThrow("api_key cannot be null");
    expect(() => new PMClient("api_key", null as unknown as string)).toThrow("api_secret cannot be null");
  });

  test("token setters update apiService", () => {
    const client = new PMClient("api_key", "api_secret");
    client.set_access_token("access_token");
    client.set_public_access_token("public_access_token");
    client.set_read_access_token("read_access_token");

    expect(apiService.accessToken).toBe("access_token");
    expect(apiService.publicAccessToken).toBe("public_access_token");
    expect(apiService.readAccessToken).toBe("read_access_token");
  });

  test("login URL uses api key and state", () => {
    const client = new PMClient("api_key", "api_secret");
    expect(client.get_login_URL("state_key")).toBe(
      "https://login.paytmmoney.com/merchant-login?apiKey=api_key&state=state_key"
    );
  });

  test("generate_session stores tokens", async () => {
    const client = new PMClient("api_key", "api_secret");
    const token = {
      access_token: "abc",
      public_access_token: "def",
      read_access_token: "ghi"
    };
    const jsonString = JSON.stringify(token);
    jest.spyOn(apiService, "apiCall").mockResolvedValue(jsonString);

    await client.generate_session("request_token");
    expect(apiService.accessToken).toBe("abc");
    expect(apiService.publicAccessToken).toBe("def");
    expect(apiService.readAccessToken).toBe("ghi");
  });

  test("security_master rejects missing file name", () => {
    const client = new PMClient("api_key", "api_secret");
    expect(() => client.security_master()).toThrow(NotFoundError);
  });

  test("place_order uses bracket endpoint for B product", () => {
    const client = new PMClient("api_key", "api_secret");
    const spy = jest.spyOn(apiService, "apiCall").mockResolvedValue("custom value");

    client.place_order(
      "B",
      "W",
      "NSE",
      "E",
      "B",
      "772",
      1,
      "DAY",
      "LMT",
      620.0,
      false,
      4,
      2
    );

    expect(spy).toHaveBeenCalledWith(
      endpoints.place_bracket[0],
      endpoints.place_bracket[1],
      "POST",
      expect.any(Object),
      null,
      null
    );
  });
});
