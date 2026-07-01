import { bootstrapRuntime } from "./runtime/bootstrap";

const runtime = await bootstrapRuntime();
const app = runtime.app.listen(runtime.env.port);

console.log(
  `${runtime.env.serviceName} listening on http://${app.server?.hostname}:${app.server?.port}`
);
