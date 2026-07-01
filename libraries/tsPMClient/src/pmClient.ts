import { apiService } from "./apiService";
import { endpoints } from "./constants";
import { NotFoundError } from "./exception";
import { EpochConverter } from "./epochConverterUtil";

type Nullable<T> = T | null;
type Numeric = number | string;

interface SessionResponse {
  access_token?: string;
  public_access_token?: string;
  read_access_token?: string;
  [key: string]: unknown;
}

export class PMClient {
  api_key: string;
  api_secret: string;
  access_token: Nullable<string>;
  public_access_token: Nullable<string>;
  read_access_token: Nullable<string>;

  constructor(
    api_key: string,
    api_secret: string,
    access_token: Nullable<string> = null,
    public_access_token: Nullable<string> = null,
    read_access_token: Nullable<string> = null
  ) {
    if (api_key == null) {
      throw new Error("api_key cannot be null");
    }
    if (api_secret == null) {
      throw new Error("api_secret cannot be null");
    }

    this.api_key = api_key;
    this.api_secret = api_secret;
    this.access_token = access_token;
    apiService.accessToken = access_token;
    this.public_access_token = public_access_token;
    apiService.publicAccessToken = public_access_token;
    this.read_access_token = read_access_token;
    apiService.readAccessToken = read_access_token;
  }

  /**
   * Set the access token
   */
  set_access_token(access_token: string) {
    this.access_token = access_token;
    apiService.accessToken = access_token;
    return this.access_token;
  }

  /**
   * Set the public access token
   */
  set_public_access_token(public_access_token: string) {
    this.public_access_token = public_access_token;
    apiService.publicAccessToken = public_access_token;
    return this.public_access_token;
  }

  /**
   * Set the read access token
   */
  set_read_access_token(read_access_token: string) {
    this.read_access_token = read_access_token;
    apiService.readAccessToken = read_access_token;
    return this.read_access_token;
  }

  /**
   * Login URL to get the request token
   */
  get_login_URL(state_key: Nullable<string>) {
    if (state_key == null) {
      throw new Error("state_key cannot be null");
    }
    return `${endpoints.login}${this.api_key}${endpoints.login_param}${state_key}`;
  }

  /**
   * Generate session and get the tokens
   */
  async generate_session(request_token: string) {
    const request_body = {
      api_key: this.api_key,
      api_secret_key: this.api_secret,
      request_token
    };

    const token = await apiService.apiCall(
      endpoints.access_token[0],
      endpoints.access_token[1],
      "POST",
      request_body,
      null,
      null
    );

    const res = JSON.parse(token) as SessionResponse;

    if (token) {
      if (res.access_token) {
        this.set_access_token(res.access_token);
      }
      if (res.public_access_token) {
        this.set_public_access_token(res.public_access_token);
      }
      if (res.read_access_token) {
        this.set_read_access_token(res.read_access_token);
      }
    }
    return res;
  }

  /**
   * Logout the session
   */
  logout() {
    return apiService.apiCall(endpoints.logout[0], endpoints.logout[1], "DELETE", null, null, null);
  }

  /**
   * Fetch User Details
   */
  get_user_details() {
    return apiService.apiCall(endpoints.user_details[0], endpoints.user_details[1], "GET", null, null, null);
  }

  // Orders
  /**
   * Place Order
   */
  place_order(
    txn_type: string,
    source: string,
    exchange: string,
    segment: string,
    product: string,
    security_id: Numeric,
    quantity: Numeric,
    validity: string,
    order_type: string,
    price: Numeric,
    off_mkt_flag = false,
    profit_value: Nullable<Numeric> = null,
    stoploss_value: Nullable<Numeric> = null,
    trigger_price: Nullable<Numeric> = null
  ) {
    const order: Record<string, unknown> = {
      txn_type,
      source,
      exchange,
      segment,
      product,
      security_id,
      quantity,
      validity,
      order_type,
      price,
      off_mkt_flag
    };
    let api = endpoints.place_regular[0];
    let tokens = endpoints.place_regular[1];

    if (order_type === "SLM" || order_type === "SL") {
      order.trigger_price = trigger_price;
    }

    if (product === "B") {
      api = endpoints.place_bracket[0];
      tokens = endpoints.place_bracket[1];
      delete order.off_mkt_flag;
      order.profit_value = profit_value;
      order.stoploss_value = stoploss_value;
    }

    if (product === "V") {
      api = endpoints.place_cover[0];
      tokens = endpoints.place_cover[1];
      delete order.off_mkt_flag;
      order.trigger_price = trigger_price;
    }
    return apiService.apiCall(api, tokens, "POST", order, null, null);
  }

  /**
   * Modify Order
   */
  modify_order(
    txn_type: string,
    source: string,
    exchange: string,
    segment: string,
    product: string,
    security_id: Numeric,
    quantity: Numeric,
    validity: string,
    order_type: string,
    price: Numeric,
    off_mkt_flag = false,
    mkt_type: string,
    order_no: Numeric,
    serial_no: Numeric,
    group_id: Numeric,
    trigger_price: Nullable<Numeric> = null,
    leg_no: Nullable<Numeric> = null,
    algo_order_no: Nullable<Numeric> = null
  ) {
    const order: Record<string, unknown> = {
      txn_type,
      source,
      exchange,
      segment,
      product,
      security_id,
      quantity,
      validity,
      order_type,
      price,
      off_mkt_flag,
      mkt_type,
      order_no,
      serial_no,
      group_id
    };

    let api = endpoints.modify_regular[0];
    let tokens = endpoints.modify_regular[1];

    if (order_type === "SLM" || order_type === "SL") {
      order.trigger_price = trigger_price;
    }

    if (product === "B") {
      api = endpoints.modify_bracket[0];
      tokens = endpoints.modify_bracket[1];
      order.leg_no = leg_no;
      order.algo_order_no = algo_order_no;
    }

    if (product === "V") {
      api = endpoints.modify_cover[0];
      tokens = endpoints.modify_cover[1];
      order.leg_no = leg_no;
    }
    return apiService.apiCall(api, tokens, "POST", order, null, null);
  }

  /**
   * Cancel Order
   */
  cancel_order(
    txn_type: string,
    source: string,
    exchange: string,
    segment: string,
    product: string,
    security_id: Numeric,
    quantity: Numeric,
    validity: string,
    order_type: string,
    price: Numeric,
    off_mkt_flag = false,
    mkt_type: string,
    order_no: Numeric,
    serial_no: Numeric,
    group_id: Numeric,
    trigger_price: Nullable<Numeric> = null,
    leg_no: Nullable<Numeric> = null,
    algo_order_no: Nullable<Numeric> = null
  ) {
    const order: Record<string, unknown> = {
      txn_type,
      source,
      exchange,
      segment,
      product,
      security_id,
      quantity,
      validity,
      order_type,
      price,
      off_mkt_flag,
      mkt_type,
      order_no,
      serial_no,
      group_id
    };
    let api = endpoints.cancel_regular[0];
    let tokens = endpoints.cancel_regular[1];

    if (order_type === "SLM" || order_type === "SL") {
      order.trigger_price = trigger_price;
    }

    if (product === "B") {
      api = endpoints.exit_bracket[0];
      tokens = endpoints.exit_bracket[1];
      order.leg_no = leg_no;
      order.algo_order_no = algo_order_no;
    }

    if (product === "V") {
      api = endpoints.exit_cover[0];
      tokens = endpoints.exit_cover[1];
      order.leg_no = leg_no;
    }
    return apiService.apiCall(api, tokens, "POST", order, null, null);
  }

  /**
   * Convert Regular Order
   */
  convert_order(
    source: string,
    txn_type: string,
    exchange: string,
    segment: string,
    mkt_type: string,
    product_from: string,
    product_to: string,
    quantity: Numeric,
    security_id: Numeric
  ) {
    const order = {
      source,
      txn_type,
      exchange,
      segment,
      mkt_type,
      product_from,
      product_to,
      quantity,
      security_id
    };
    return apiService.apiCall(endpoints.convert_regular[0], endpoints.convert_regular[1], "POST", order, null, null);
  }

  // Order & Trade Book
  /**
   * Order Book
   */
  order_book() {
    return apiService.apiCall(endpoints.order_book[0], endpoints.order_book[1], "GET", null, null, null);
  }

  /**
   * All Orders
   */
  orders() {
    return apiService.apiCall(endpoints.orders[0], endpoints.orders[1], "GET", null, null, null);
  }

  /**
   * Trade Details
   */
  trade_details(order_no: Numeric, leg_no: Numeric, segment: string) {
    const params = {
      order_no,
      leg_no,
      segment
    };
    return apiService.apiCall(endpoints.trade_details[0], endpoints.trade_details[1], "GET", null, params, null);
  }

  /**
   * Positions
   */
  position() {
    return apiService.apiCall(endpoints.position[0], endpoints.position[1], "GET", null, null, null);
  }

  /**
   * Position details of the security_id
   */
  position_details(security_id: Numeric, product: string, exchange: string) {
    const params = {
      security_id,
      product,
      exchange
    };
    return apiService.apiCall(endpoints.position_details[0], endpoints.position_details[1], "GET", null, params, null);
  }

  /**
   * Funds Summary
   */
  funds_summary(config = false) {
    const params = {
      config
    };
    return apiService.apiCall(endpoints.funds_summary[0], endpoints.funds_summary[1], "GET", null, params, null);
  }

  /**
   * Holdings Value
   */
  holdings_value() {
    return apiService.apiCall(endpoints.holdings_value[0], endpoints.holdings_value[1], "GET", null, null, null);
  }

  /**
   * User Holdings Data
   */
  user_holdings_data() {
    return apiService.apiCall(
      endpoints.user_holdings_data[0],
      endpoints.user_holdings_data[1],
      "GET",
      null,
      null,
      null
    );
  }

  // Margins
  /**
   * Order Margin
   */
  order_margin(
    source: string,
    exchange: string,
    segment: string,
    security_id: Numeric,
    txn_type: string,
    quantity: Numeric,
    price: Numeric,
    product: string,
    trigger_price: Numeric
  ) {
    const params = {
      source,
      exchange,
      segment,
      security_id,
      txn_type,
      quantity,
      price,
      product,
      trigger_price
    };
    return apiService.apiCall(endpoints.order_margin[0], endpoints.order_margin[1], "GET", null, params, null);
  }

  /**
   * Scrips Margin
   */
  scrips_margin(source: string, margin_list: Array<Record<string, unknown>> | null) {
    const safeMarginList = margin_list ?? [];
    const order = {
      source,
      margin_list: safeMarginList
    };
    return apiService.apiCall(endpoints.scrips_margin[0], endpoints.scrips_margin[1], "POST", order, null, null);
  }

  /**
   * Security Master
   */
  security_master(file_name?: Nullable<string>) {
    if (!file_name) {
      throw new NotFoundError("File name should not be null or empty");
    }
    const path_params = {
      file_name
    };
    return apiService.apiCall(endpoints.security_master[0], endpoints.security_master[1], "GET", null, null, path_params);
  }

  /**
   * Generate TPIN for CDSL
   */
  generate_tpin() {
    return apiService.apiCall(endpoints.generate_tpin[0], endpoints.generate_tpin[1], "GET", null, null, null);
  }

  /**
   * Validate the TPIN
   */
  validate_tpin(trade_type: string, isin_list: Array<Record<string, unknown>>) {
    const order = {
      trade_type,
      isin_list
    };
    return apiService.apiCall(endpoints.validate_tpin[0], endpoints.validate_tpin[1], "POST", order, null, null);
  }

  /**
   * Status of Transaction
   */
  status(edis_request_id: Numeric) {
    const params = {
      edis_request_id
    };
    return apiService.apiCall(endpoints.status[0], endpoints.status[1], "GET", null, params, null);
  }

  /**
   * Get GTT by status or pml_id
   */
  get_gtt_by_status_or_pml_id(status: Nullable<string> = null, pml_id: Nullable<string> = null) {
    if (status != null && status !== "" && pml_id != null && pml_id !== "") {
      const params = {
        status,
        "pml-id": pml_id
      };
      return apiService.apiCall(endpoints.gtt[0], endpoints.gtt[1], "GET", null, params, null);
    }
    if (status != null && status !== "" && (pml_id == null || pml_id === "")) {
      const params = {
        status
      };
      return apiService.apiCall(endpoints.gtt[0], endpoints.gtt[1], "GET", null, params, null);
    }
    if ((status == null || status === "") && pml_id != null && pml_id !== "") {
      const params = {
        "pml-id": pml_id
      };
      return apiService.apiCall(endpoints.gtt[0], endpoints.gtt[1], "GET", null, params, null);
    }
    return apiService.apiCall(endpoints.gtt[0], endpoints.gtt[1], "GET", null, null, null);
  }

  /**
   * Create GTT order
   */
  create_gtt(
    segment: string,
    exchange: string,
    pml_id: string,
    security_id: Numeric,
    product_type: Numeric,
    set_price: Numeric,
    transaction_type: Numeric,
    order_type: Numeric,
    trigger_type: Numeric,
    quantity: Numeric,
    trigger_price: Numeric,
    limit_price: Numeric
  ) {
    const transaction_details = [
      {
        quantity,
        trigger_price,
        limit_price
      }
    ];

    const order = {
      segment,
      exchange,
      "pml-id": pml_id,
      security_id,
      product_type,
      set_price,
      transaction_type,
      order_type,
      trigger_type,
      transaction_details
    };
    return apiService.apiCall(endpoints.gtt[0], endpoints.gtt[1], "POST", order, null, null);
  }

  /**
   * Get GTT
   */
  get_gtt(id: Numeric) {
    const path_params = {
      id
    };
    return apiService.apiCall(endpoints.gtt_by_id[0], endpoints.gtt_by_id[1], "GET", null, null, path_params);
  }

  /**
   * Update GTT order
   */
  update_gtt(
    id: Numeric,
    set_price: Nullable<Numeric> = null,
    transaction_type: Nullable<Numeric> = null,
    order_type: Nullable<Numeric> = null,
    trigger_type: Nullable<Numeric> = null,
    quantity: Nullable<Numeric> = null,
    trigger_price: Nullable<Numeric> = null,
    limit_price: Nullable<Numeric> = null
  ) {
    const path_params = {
      id
    };

    const transaction_details = [
      {
        quantity,
        trigger_price,
        limit_price
      }
    ];

    const order = {
      set_price,
      transaction_type,
      order_type,
      trigger_type,
      transaction_details
    };
    return apiService.apiCall(endpoints.gtt_by_id[0], endpoints.gtt_by_id[1], "PUT", order, null, path_params);
  }

  /**
   * Delete GTT order
   */
  delete_gtt(id: Numeric) {
    const path_params = {
      id
    };
    return apiService.apiCall(endpoints.gtt_by_id[0], endpoints.gtt_by_id[1], "DELETE", null, null, path_params);
  }

  /**
   * GET GTT Aggregate
   */
  get_gtt_aggregate() {
    return apiService.apiCall(endpoints.gtt_aggregate[0], endpoints.gtt_aggregate[1], "GET", null, null, null);
  }

  /**
   * Get GTT expiry date by pml_id
   */
  get_gtt_expiry(pml_id: string) {
    const params = {
      "pml-id": pml_id
    };
    return apiService.apiCall(endpoints.expiry_gtt[0], endpoints.expiry_gtt[1], "GET", null, params, null);
  }

  /**
   * Get GTT order by Instruction id
   */
  get_gtt_by_instruction_id(id: Numeric) {
    const path_params = {
      id
    };
    return apiService.apiCall(
      endpoints.gtt_by_instruction_id[0],
      endpoints.gtt_by_instruction_id[1],
      "GET",
      null,
      null,
      path_params
    );
  }

  /**
   * Get GTT by status or pml_id v2
   */
  get_gtt_by_status_or_pml_id_v2(status: Nullable<string> = null, pml_id: Nullable<string> = null) {
    if (status != null && status !== "" && pml_id != null && pml_id !== "") {
      const params = {
        status,
        "pml-id": pml_id
      };
      return apiService.apiCall(endpoints.gtt_v2[0], endpoints.gtt_v2[1], "GET", null, params, null);
    }
    if (status != null && status !== "" && (pml_id == null || pml_id === "")) {
      const params = {
        status
      };
      return apiService.apiCall(endpoints.gtt_v2[0], endpoints.gtt_v2[1], "GET", null, params, null);
    }
    if ((status == null || status === "") && pml_id != null && pml_id !== "") {
      const params = {
        "pml-id": pml_id
      };
      return apiService.apiCall(endpoints.gtt_v2[0], endpoints.gtt_v2[1], "GET", null, params, null);
    }
    return apiService.apiCall(endpoints.gtt_v2[0], endpoints.gtt_v2[1], "GET", null, null, null);
  }

  /**
   * Create GTT order v2
   */
  create_gtt_v2(
    segment: string,
    exchange: string,
    security_id: Numeric,
    product_type: Numeric,
    set_price: Numeric,
    transaction_type: Numeric,
    trigger_type: Numeric,
    transaction_details: Array<Record<string, unknown>>
  ) {
    const order = {
      segment,
      exchange,
      security_id,
      product_type,
      set_price,
      transaction_type,
      trigger_type,
      transaction_details
    };
    return apiService.apiCall(endpoints.gtt_v2[0], endpoints.gtt_v2[1], "POST", order, null, null);
  }

  /**
   * Get GTT v2
   */
  get_gtt_v2(id: Numeric) {
    const path_params = {
      id
    };
    return apiService.apiCall(endpoints.gtt_by_id_v2[0], endpoints.gtt_by_id_v2[1], "GET", null, null, path_params);
  }

  /**
   * Update GTT order v2
   */
  update_gtt_v2(
    id: Numeric,
    set_price: Nullable<Numeric> = null,
    transaction_type: Nullable<Numeric> = null,
    trigger_type: Nullable<Numeric> = null,
    transaction_details: Array<Record<string, unknown>> | null = null
  ) {
    const path_params = {
      id
    };

    const order = {
      set_price,
      transaction_type,
      trigger_type,
      transaction_details
    };
    return apiService.apiCall(endpoints.gtt_by_id_v2[0], endpoints.gtt_by_id_v2[1], "PUT", order, null, path_params);
  }

  /**
   * Get GTT order by Instruction id v2
   */
  get_gtt_by_instruction_id_v2(id: Numeric) {
    const path_params = {
      id
    };
    return apiService.apiCall(
      endpoints.gtt_by_instruction_id_v2[0],
      endpoints.gtt_by_instruction_id_v2[1],
      "GET",
      null,
      null,
      path_params
    );
  }

  /**
   * Live Market Data
   */
  get_live_market_data(mode_type: string, preferences: string) {
    const path_params = {
      mode_type,
      preferences
    };
    const responsePromise = apiService
      .apiCall(endpoints.live_market_data[0], endpoints.live_market_data[1], "GET", null, null, path_params)
      .then((response) => {
        const parsed = JSON.parse(response) as { data?: Array<Record<string, unknown>> };
        parsed.data?.forEach((tick) => {
          if (typeof tick.last_trade_time === "number") {
            tick.last_trade_time = EpochConverter(tick.last_trade_time);
          }
          if (typeof tick.last_update_time === "number") {
            tick.last_update_time = EpochConverter(tick.last_update_time);
          }
        });
        return JSON.stringify(parsed);
      });
    return responsePromise;
  }

  /**
   * Option Chain
   */
  get_option_chain(type: string, symbol: string, expiry: string) {
    const path_params = {
      type,
      symbol,
      expiry
    };
    return apiService.apiCall(endpoints.option_chain[0], endpoints.option_chain[1], "GET", null, null, path_params);
  }

  /**
   * Option Chain Config
   */
  get_option_chain_config(symbol: string) {
    const path_params = {
      symbol
    };
    return apiService.apiCall(
      endpoints.option_chain_config[0],
      endpoints.option_chain_config[1],
      "GET",
      null,
      null,
      path_params
    );
  }

  /**
   * Brokerage Charges Info
   */
  charges_info(
    brokerage_profile_code: string,
    transaction_type: string,
    product_type: string,
    instrument_type: string,
    exchange: string,
    qty: Numeric,
    price: Numeric
  ) {
    const charges_info = {
      brokerage_profile_code,
      transaction_type,
      product_type,
      instrument_type,
      exchange,
      qty,
      price
    };

    return apiService.apiCall(endpoints.charges_info[0], endpoints.charges_info[1], "POST", charges_info, null, null);
  }
}
