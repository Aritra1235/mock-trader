import { loadOperatorEnv } from "../config/env";
import { PaytmHttpClient } from "../providers/paytmHttpClient";
import { PaytmSessionService } from "../services/paytmSessionService";

export function createOperatorAuthServices() {
  const env = loadOperatorEnv();
  const client = new PaytmHttpClient(env.paytm.apiKey, env.paytm.apiSecret);
  const session = new PaytmSessionService(client, env.paths.session);

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
