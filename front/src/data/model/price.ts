import { DMAbstract } from "@/data/model/dmAbstract";
import router from "@/router";
import type { Ref } from "vue";
import { ref } from "vue";

type TDMPrice = {
  product_id: number,
  offer_id: string,
  name: string,
  marketing_price: number,
  marketing_seller_price: number,
  incoming_price: number,
  min_price: number,
  price: number,
  old_price: number,
  min_perc: number,
  perc: number,
  old_perc: number,
  adv_perc: number,
  sales_percent: number,
  fbs_direct_flow_trans_max_amount: number
}

class DMPrice extends DMAbstract<TDMPrice[]> {
  limit: number;
  #last_id?: string;

  #offer_id?: string[];
  #product_id?: number[];
  #visibility?: string;
  isLoading: Ref<boolean>;

  constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string
  ) {
    super(onChange, urlTransformer);
    this.limit = 5;
    this.isLoading = ref(false)
  }

  getData(params?: {offer_id?: string[], product_id?: number[], visibility?: string}) {
    if (JSON.stringify([this.#visibility, ...(this.#offer_id ?? []), ...(this.#product_id ?? [])]) !== JSON.stringify([params?.visibility, ...(params?.offer_id ?? []), ...(params?.product_id ?? [])])) this.#last_id = undefined;
    this.#product_id = params?.product_id;
    this.#offer_id = params?.offer_id;
    this.#visibility = params?.visibility;
    this.data = undefined;
    this.getNext().finally(()=>{});
  }

  async getNext() {
    this.isLoading.value = true;

    const query = {offer_id: this.#offer_id, product_id: this.#product_id, visibility: this.#visibility, limit: this.limit, last_id: this.#last_id}
    const url = router.resolve({ name: 'api-price', query}).href;
    console.log(url)
    const {data, last_id} = await this.getJson(url);
    this.#last_id = last_id;
    this.data ??= [];
    this.data.push(...(data as TDMPrice[]));

    this.isLoading.value = false;
  }
}

export {
  DMPrice
}

export type {
  TDMPrice
}