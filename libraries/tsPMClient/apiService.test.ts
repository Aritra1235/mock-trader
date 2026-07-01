import request from "request";
import { apiService } from "./src/apiService";
import { NotFoundError } from "./src/exception";

jest.mock("request");

const mockedRequest = request as unknown as jest.Mock;

describe("apiService.apiCall", () => {
  afterEach(() => {
    mockedRequest.mockReset();
  });

  it("throws when required token is missing", () => {
    expect(() => apiService.apiCall("/example", ["access_token"], "GET")).toThrow(NotFoundError);
  });

  it("resolves body for successful response", async () => {
    mockedRequest.mockImplementation((options, callback) => {
      callback(null, { statusCode: 200 }, JSON.stringify({ message: "success" }));
    });

    const response = await apiService.apiCall("/example", [], "GET");
    expect(response).toBe(JSON.stringify({ message: "success" }));
  });
});
