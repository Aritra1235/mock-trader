import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PaytmSession } from "../types/paytm";


export async function loadSession(filePath: string): Promise<PaytmSession | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as PaytmSession;
  } catch {
    return null;
  }
}

export async function saveSession(
  filePath: string,
  tokens: Pick<PaytmSession, "access_token" | "public_access_token" | "read_access_token" | "request_token">
): Promise<PaytmSession> {
  await mkdir(dirname(filePath), { recursive: true });
  const session: PaytmSession = {
    ...tokens,
    updated_at: new Date().toISOString(),
  };
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  return session;
}
