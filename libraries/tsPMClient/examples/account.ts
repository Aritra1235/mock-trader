import { PMClient } from "../src/pmClient";

const connect = new PMClient("api_key", "api_secret");

connect.generate_session("your_request_token");

connect.set_access_token("your_access_token");
connect.set_public_access_token("your_public_access_token");
connect.set_read_access_token("your_read_access_token");

connect
  .get_user_details()
  .then((response) => {
    console.log(response);
  })
  .catch((err) => {
    console.log(err);
  });
