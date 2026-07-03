import { bootstrapRuntime } from "./runtime/bootstrap";

const runtime = await bootstrapRuntime();
const app = runtime.app.listen(runtime.env.service.port);

console.log(
  `${runtime.env.service.name} listening on http://${app.server?.hostname}:${app.server?.port}`
);
