import { loadCatalogWorkerEnv } from "../src/config/env";
import { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import { CatalogService } from "../src/services/catalogService";

const env = loadCatalogWorkerEnv();
const client = new PaytmHttpClient(env.paytm.apiKey, env.paytm.apiSecret);
const catalog = new CatalogService(
  client,
  env.paths.catalogSnapshot,
  env.catalog.files
);

const count = await catalog.syncFromProvider();
console.log(
  `Catalog sync complete: ${count} instruments written to ${env.paths.catalogSnapshot}`
);
