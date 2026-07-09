import { loadOperatorEnv } from "../src/config/env";
import { buildInstrumentKey, preferenceToRestPreference } from "../src/lib/market";
import { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import { CatalogService } from "../src/services/catalogService";
import { PaytmSessionService } from "../src/services/paytmSessionService";

const symbol = process.env.VERIFY_SYMBOL ?? Bun.argv[2] ?? "RELIANCE";
const env = loadOperatorEnv();
const client = new PaytmHttpClient(env.paytm.apiKey, env.paytm.apiSecret);
const session = new PaytmSessionService(client, env.paths.session);
const catalog = new CatalogService(
  client,
  env.paths.catalogSnapshot,
  env.catalog.files
);

await catalog.loadSnapshot();

if (catalog.count() === 0) {
  await catalog.syncFromProvider();
}

const instrument = catalog.resolve(symbol);
if (!instrument) {
  throw new Error(`No instrument found for ${symbol}`);
}

const token = await session.requireReadableToken();
const preference = {
  exchangeType: instrument.exchange,
  modeType: env.market.upstreamMode,
  scripType: instrument.scripType,
  scripId: instrument.securityId,
};

const restPreference = preferenceToRestPreference({
  instrumentKey: instrument.instrumentKey,
  securityId: instrument.securityId,
  exchangeType: instrument.exchange,
  scripType: instrument.scripType,
  modeType: env.market.upstreamMode,
});

const quote = await client.fetchLiveMarketData(token, env.market.upstreamMode, [
  restPreference,
]);

console.log(
  JSON.stringify(
    {
      symbol,
      instrumentKey: buildInstrumentKey(
        instrument.exchange,
        instrument.scripType,
        instrument.securityId
      ),
      preference,
      restPreference,
      providerResponse: quote,
    },
    null,
    2
  )
);
