import { log } from "./lib/log";
import { bootstrapRuntime } from "./runtime/bootstrap";

const runtime = await bootstrapRuntime();
const app = runtime.app.listen(runtime.env.service.port);

log.info("api listening", {
  service: runtime.env.service.name,
  url: `http://${app.server?.hostname}:${app.server?.port}`,
});
