import createClient from "openapi-fetch";
import type { paths } from "../generated/api-schema";

export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
  credentials: "include",
});

export function createIdempotencyKey() {
  return crypto.randomUUID();
}
