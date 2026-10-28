import { loadCatalogWorkerEnv } from "../src/config/env";
import { log } from "../src/lib/log";
import { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import { CatalogService } from "../src/services/catalogService";

const env = loadCatalogWorkerEnv();
const client = new PaytmHttpClient(env.paytm.apiKey, env.paytm.apiSecret);
const catalog = new CatalogService(
  client,
  env.paths.catalogSnapshot,
  env.catalog.files,
);

const count = await catalog.syncFromProvider();
log.info("catalog sync complete", {
  instruments: count,
  snapshot: env.paths.catalogSnapshot,
});
