import { loadEnv } from "../config/env";
import { PaytmHttpClient } from "../providers/paytmHttpClient";
import { PaytmSessionService } from "../services/paytmSessionService";

export function createOperatorAuthServices() {
  const env = loadEnv();
  const client = new PaytmHttpClient(env.paytmApiKey, env.paytmApiSecret);
  const session = new PaytmSessionService(client, env.sessionPath);

  return {
    env,
    client,
    session,
  };
}

export function createPaytmLoginUrl(state = crypto.randomUUID()) {
  const { session } = createOperatorAuthServices();
  return session.getLoginUrl(state);
}

export async function exchangePaytmRequestToken(requestToken: string) {
  const { session } = createOperatorAuthServices();
  return session.createSession(requestToken);
}

export async function getPaytmOperatorSessionStatus() {
  const { session } = createOperatorAuthServices();
  return session.getStatus();
}
