import { describe, expect, test } from "bun:test";
import createClient from "openapi-fetch";
import { instrumentIdFromRoute } from "./instrument-route";

describe("instrumentIdFromRoute", () => {
  test("decodes an encoded route segment before the API client serializes it", () => {
    expect(instrumentIdFromRoute("BSE%3AEQUITY%3A500180")).toBe(
      "BSE:EQUITY:500180",
    );
  });

  test("leaves an already decoded route segment alone", () => {
    expect(instrumentIdFromRoute("BSE:EQUITY:500180")).toBe(
      "BSE:EQUITY:500180",
    );
  });

  test("does not crash on malformed percent encoding", () => {
    expect(instrumentIdFromRoute("BSE%ZZ")).toBe("BSE%ZZ");
  });

  test("sends an instrument key with exactly one encoding pass", async () => {
    let requestedPath = "";
    const client = createClient({
      baseUrl: "http://localhost:5000",
      fetch: async (request) => {
        requestedPath = new URL(request.url).pathname;
        return Response.json({ instrumentKey: "BSE:EQUITY:500180" });
      },
    });

    await client.GET("/api/v1/market/instruments/{id}", {
      params: {
        path: { id: instrumentIdFromRoute("BSE%3AEQUITY%3A500180") },
      },
    });

    expect(requestedPath).toBe(
      "/api/v1/market/instruments/BSE%3AEQUITY%3A500180",
    );
  });
});
