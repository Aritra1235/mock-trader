import createClient from "openapi-fetch";
import type { paths } from "../generated/api-schema";
import { apiBase } from "./endpoints";

export const apiClient = createClient<paths>({
  baseUrl: apiBase,
  credentials: "include",
});

export function createIdempotencyKey() {
  return crypto.randomUUID();
}
