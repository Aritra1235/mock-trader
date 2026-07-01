import { loadEnv } from "../src/config/env";
import { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import { CatalogService } from "../src/services/catalogService";

const env = loadEnv();
const client = new PaytmHttpClient(env.paytmApiKey, env.paytmApiSecret);
const catalog = new CatalogService(client, env.catalogSnapshotPath, env.catalogFiles);

const count = await catalog.syncFromProvider();
console.log(`Catalog sync complete: ${count} instruments written to ${env.catalogSnapshotPath}`);
