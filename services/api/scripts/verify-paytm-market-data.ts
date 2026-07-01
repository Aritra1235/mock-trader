import { loadEnv } from "../src/config/env";
import { buildInstrumentKey, preferenceToRestPreference } from "../src/lib/market";
import { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import { CatalogService } from "../src/services/catalogService";
import { PaytmSessionService } from "../src/services/paytmSessionService";

const symbol = process.env.VERIFY_SYMBOL ?? Bun.argv[2] ?? "RELIANCE";
const env = loadEnv();
const client = new PaytmHttpClient(env.paytmApiKey, env.paytmApiSecret);
const session = new PaytmSessionService(client, env.sessionPath);
const catalog = new CatalogService(client, env.catalogSnapshotPath, env.catalogFiles);

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
  modeType: env.upstreamMode,
  scripType: instrument.scripType,
  scripId: instrument.securityId,
};

const restPreference = preferenceToRestPreference({
  instrumentKey: instrument.instrumentKey,
  securityId: instrument.securityId,
  exchangeType: instrument.exchange,
  scripType: instrument.scripType,
  modeType: env.upstreamMode,
});

const quote = await client.fetchLiveMarketData(token, env.upstreamMode, [restPreference]);

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
