import { DMAbstract } from "@/data/model/dmAbstract";
import router from "@/router";
import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";
import type { DMPricePreset } from "@/data/model/pricePreset";

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
  fbs_direct_flow_trans_max_amount: number,
}

class DMPrice {
  data: TDMPrice;

  e_old_perc: Ref<number>;
  e_perc: Ref<number>;
  e_min_perc: Ref<number>;
  e_adv_perc: Ref<number>;

  currentPayment: ComputedRef<number>;
  calculatedPayment: ComputedRef<number>;
  maxCalculated: ComputedRef<number>;
  normCalculated: ComputedRef<number>;
  minCalculated: ComputedRef<number>;

  currentPaymentChanged: ComputedRef<boolean>;

  #preset: DMPricePreset;
  #fvCurrentPayment?: number;

  constructor(data: TDMPrice, preset: DMPricePreset) {
    this.data = data;
    this.#preset = preset;
    this.e_adv_perc = ref(data.adv_perc);
    this.e_min_perc = ref(data.min_perc);
    this.e_old_perc = ref(data.old_perc);
    this.e_perc = ref(data.perc);

    this.currentPaymentChanged = computed(()=>{
      return this.currentPayment.value !== this.#fvCurrentPayment;
    });

    this.currentPayment = computed(()=>{
      if (!this.#preset.data) throw Error('no preset data');
      const value = this.data.marketing_seller_price - this.data.fbs_direct_flow_trans_max_amount - this.#preset.data.sum_obtain - this.#preset.data.sum_pack - this.data.marketing_seller_price * (this.#preset.data.perc_ekv + this.#preset.data.perc_mil + this.data.sales_percent + this.e_adv_perc.value) / 100;
      this.#fvCurrentPayment ??= value;
      return value;

      // =marketing_seller_price-fbs_direct_flow_trans_max_amount-preset.sum_obtain-preset.sum_pack-maketing_seller_price*(preset.perc_ekv+preset.perc_mil+sales_percent+adv_perc)/100

    });

    this.maxCalculated = computed(()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return ( this.data.incoming_price * ( 1 + this.e_old_perc.value / 100 ) + this.#preset.data.sum_obtain + this.#preset.data.sum_pack + this.data.fbs_direct_flow_trans_max_amount ) / ( 1 - ( this.data.sales_percent + this.e_adv_perc.value + this.#preset.data.perc_mil + this.#preset.data.perc_ekv) / 100);

      // =(incoming_price*(1+old_perc/100)+prset. sum_obtain+preset. sum_pack+fbs_direct_flow_trans_max_amount)/(1-(sales_percent+adv_perc+preset.perc_mil+prset.perc_ekv)/100)
    });

    this.normCalculated = computed(()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return ( this.data.incoming_price * ( 1 + this.e_perc.value / 100 ) + this.#preset.data.sum_obtain + this.#preset.data.sum_pack + this.data.fbs_direct_flow_trans_max_amount ) / ( 1 - (this.data.sales_percent + this.e_adv_perc.value + this.#preset.data.perc_mil + this.#preset.data.perc_ekv) / 100 );

      // =(incoming_price*(1+perc/100)+prset. sum_obtain+ppreset. sum_pack+fbs_direct_flow_trans_max_amount)/(1-(sales_percent+adv_perc+preset.perc_mil+prset.perc_ekv)/100)
    });

    this.minCalculated = computed(()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return ( this.data.incoming_price * ( 1 + this.e_min_perc.value / 100 ) + this.#preset.data.sum_obtain + this.#preset.data.sum_pack + this.data.fbs_direct_flow_trans_max_amount ) / ( 1 - ( this.data.sales_percent + this.e_adv_perc.value + this.#preset.data.perc_mil + this.#preset.data.perc_ekv ) / 100);

      // =(incoming_price*(1+min_perc/100)+prset. sum_obtain+ppreset. sum_pack+fbs_direct_flow_trans_max_amount)/(1-(sales_percent+adv_perc+preset.perc_mil+prset.perc_ekv)/100)
    });

    this.calculatedPayment = this.normCalculated;
  }
}

class DMPrices extends DMAbstract<DMPrice[]> {
  limit: number;
  #last_id?: string;

  #offer_id?: string[];
  #product_id?: number[];
  #visibility?: string;
  #preset: DMPricePreset;

  constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string,
    preset: DMPricePreset
  ) {
    super(onChange, urlTransformer);
    this.limit = 5;
    this.#preset = preset
  }

  getData(params?: {offer_id?: string[], product_id?: number[], visibility?: string}) {
    if (JSON.stringify([this.#visibility, ...(this.#offer_id ?? []), ...(this.#product_id ?? [])]) !== JSON.stringify([params?.visibility, ...(params?.offer_id ?? []), ...(params?.product_id ?? [])])) this.#last_id = undefined;
    this.#product_id = params?.product_id;
    this.#offer_id = params?.offer_id;
    this.#visibility = params?.visibility;
    this.getNext().finally(()=>{});
  }

  async getNext() {
    const query = {offer_id: this.#offer_id, product_id: this.#product_id, visibility: this.#visibility, limit: this.limit, last_id: this.#last_id}
    const url = router.resolve({ name: 'api-price', query}).href;
    console.log(url)
    const {data, last_id} = await this.getJson(url);
    const _data: DMPrice[] = data.map((i: TDMPrice) => new DMPrice(i, this.#preset));
    this.#last_id = last_id;
    this.data ??= [];
    this.data.push(..._data);
    this.changed();
  }
}

export {
  DMPrices
}

export type {
  TDMPrice
}