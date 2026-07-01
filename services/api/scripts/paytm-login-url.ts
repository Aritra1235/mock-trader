import { createPaytmLoginUrl } from "../src/operator/paytmAuth";

const stateArg = Bun.argv.find((arg) => arg.startsWith("--state="));
const state = stateArg?.slice("--state=".length);

console.log(createPaytmLoginUrl(state));
