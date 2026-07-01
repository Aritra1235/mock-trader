import { getPaytmOperatorSessionStatus } from "../src/operator/paytmAuth";

console.log(JSON.stringify(await getPaytmOperatorSessionStatus(), null, 2));
