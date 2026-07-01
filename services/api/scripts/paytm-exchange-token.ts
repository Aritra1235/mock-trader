import { exchangePaytmRequestToken } from "../src/operator/paytmAuth";

const token =
  process.env.PAYTM_REQUEST_TOKEN ??
  Bun.argv.slice(2).find((arg) => !arg.startsWith("--"));

if (!token) {
  throw new Error(
    "Pass a request token as an argument or set PAYTM_REQUEST_TOKEN."
  );
}

const session = await exchangePaytmRequestToken(token);
console.log(
  JSON.stringify(
    {
      success: true,
      updatedAt: session.updated_at,
      hasPublicToken: Boolean(session.public_access_token),
      hasReadToken: Boolean(session.read_access_token),
    },
    null,
    2
  )
);
