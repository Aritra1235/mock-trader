import { PMClient } from "../src/pmClient";

const connect = new PMClient("api_key", "api_secret");

connect.generate_session("your_request_token");

connect.set_access_token("your_access_token");
connect.set_public_access_token("your_public_access_token");
connect.set_read_access_token("your_read_access_token");

connect
  .generate_tpin()
  .then((response) => {
    console.log(response);
  })
  .catch((err) => {
    console.log(err);
  });

// PIN sent on mobile number. Wait for 6 minutes.

connect
  .validate_tpin("PRE", [
    {
      isin: "isin",
      qty: 2
    },
    {
      isin: "isin",
      qty: 3
    }
  ])
  .then((response) => {
    console.log(response);
  })
  .catch((err) => {
    console.log(err);
  });

// In response, we get the edis_request_id

connect
  .status("edis_request_token")
  .then((response) => {
    console.log(response);
  })
  .catch((err) => {
    console.log(err);
  });
