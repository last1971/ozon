import { DMAbstract, DMApiMethods } from "@/data/model/dmAbstract";
import router from "@/router";
import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";
import type { DMPricePreset } from "@/data/model/pricePreset";
import { ExtComputedRef, ExtRef, stringToNumberCorrection, upToHund } from "@/extensions";
import type { DMVisibility } from "@/data/model/visibility";

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

class DMPrice extends DMApiMethods{
  data: Ref<TDMPrice>;

  e_old_perc: ExtRef<number>;
  e_perc: ExtRef<number>;
  e_min_perc: ExtRef<number>;
  e_adv_perc: ExtRef<number>;

  currentPayment: ExtComputedRef<number>;
  calculatedPayment: ExtComputedRef<number>;
  maxCalculated: ExtComputedRef<number>;
  normCalculated: ExtComputedRef<number>;
  minCalculated: ExtComputedRef<number>;
  comCalculated: ExtComputedRef<number>;
  rekCalculated: ExtComputedRef<number>;

  percentChanged: ComputedRef<boolean>;
  priceChanged: ComputedRef<boolean>;
  percentSaving: Ref<boolean>;
  priceSaving: Ref<boolean>;

  #preset: DMPricePreset;

  currentCom() {
    return Math.ceil(this.data.value.price * this.data.value.sales_percent / 100);
  }
  currentRek() {
    return Math.ceil(this.data.value.price * this.data.value.adv_perc / 100);
  }

  constructor(data: TDMPrice, preset: DMPricePreset, urlTransformer: (url: string) => string,) {
    super(urlTransformer);
    this.#preset = preset;
    this.percentSaving = ref(false);
    this.priceSaving = ref(false);
    this.data = ref(stringToNumberCorrection(data, ['product_id', 'offer_id']));
    this.data.value.adv_perc ??= 0;
    this.data.value.min_perc ??= this.#preset.data?.perc_min ?? 0;
    this.data.value.old_perc ??= this.#preset.data?.perc_max ?? 0;
    this.data.value.perc ??= this.#preset.data?.perc_nor ?? 0;
    this.e_adv_perc = new ExtRef<number>(upToHund, this.data.value.adv_perc);
    this.e_min_perc = new ExtRef<number>(upToHund, this.data.value.min_perc);
    this.e_old_perc = new ExtRef<number>(upToHund, this.data.value.old_perc);
    this.e_perc = new ExtRef<number>(upToHund, this.data.value.perc);

    this.comCalculated = new ExtComputedRef(Math.ceil, ()=>{
      return this.normCalculated.value * this.data.value.sales_percent / 100;

      // sales_percent / 100   * рас цена
    });

    this.rekCalculated = new ExtComputedRef(Math.ceil, ()=>{
      return this.normCalculated.value * this.e_adv_perc.value / 100;

      // (adv_price/100) * рас цена
    });

    this.currentPayment = new ExtComputedRef(Math.ceil, ()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return this.data.value.marketing_seller_price - this.data.value.fbs_direct_flow_trans_max_amount - this.#preset.data.sum_obtain - this.#preset.data.sum_pack - this.data.value.marketing_seller_price * (this.#preset.data.perc_ekv + this.#preset.data.perc_mil + this.data.value.sales_percent + this.e_adv_perc.value) / 100;

      // =marketing_seller_price-fbs_direct_flow_trans_max_amount-preset.sum_obtain-preset.sum_pack-maketing_seller_price*(preset.perc_ekv+preset.perc_mil+sales_percent+adv_perc)/100

    });

    this.maxCalculated = new ExtComputedRef(Math.ceil, ()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return ( this.data.value.incoming_price * ( 1 + this.e_old_perc.value / 100 ) + this.#preset.data.sum_obtain + this.#preset.data.sum_pack + this.data.value.fbs_direct_flow_trans_max_amount ) / ( 1 - ( this.data.value.sales_percent + this.e_adv_perc.value + this.#preset.data.perc_mil + this.#preset.data.perc_ekv) / 100);

      // =(incoming_price*(1+old_perc/100)+prset. sum_obtain+preset. sum_pack+fbs_direct_flow_trans_max_amount)/(1-(sales_percent+adv_perc+preset.perc_mil+prset.perc_ekv)/100)
    });

    this.normCalculated = new ExtComputedRef(Math.ceil, ()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return ( this.data.value.incoming_price * ( 1 + this.e_perc.value / 100 ) + this.#preset.data.sum_obtain + this.#preset.data.sum_pack + this.data.value.fbs_direct_flow_trans_max_amount ) / ( 1 - (this.data.value.sales_percent + this.e_adv_perc.value + this.#preset.data.perc_mil + this.#preset.data.perc_ekv) / 100 );

      // =(incoming_price*(1+perc/100)+prset. sum_obtain+ppreset. sum_pack+fbs_direct_flow_trans_max_amount)/(1-(sales_percent+adv_perc+preset.perc_mil+prset.perc_ekv)/100)
    });

    this.minCalculated = new ExtComputedRef(Math.ceil, ()=>{
      if (!this.#preset.data) throw Error('no preset data');
      return ( this.data.value.incoming_price * ( 1 + this.e_min_perc.value / 100 ) + this.#preset.data.sum_obtain + this.#preset.data.sum_pack + this.data.value.fbs_direct_flow_trans_max_amount ) / ( 1 - ( this.data.value.sales_percent + this.e_adv_perc.value + this.#preset.data.perc_mil + this.#preset.data.perc_ekv ) / 100);

      // =(incoming_price*(1+min_perc/100)+prset. sum_obtain+ppreset. sum_pack+fbs_direct_flow_trans_max_amount)/(1-(sales_percent+adv_perc+preset.perc_mil+prset.perc_ekv)/100)
    });

    this.calculatedPayment = this.normCalculated;

    this.percentChanged = computed(()=>{
      const ret = this.e_adv_perc.value !== this.data.value.adv_perc ||
        this.e_perc.value !== this.data.value.perc ||
        this.e_old_perc.value !== this.data.value.old_perc ||
        this.e_min_perc.value !== this.data.value.min_perc;
      console.log(ret);
      return ret;
    });
    this.priceChanged = computed(()=>{
      return this.comCalculated.isProcessedChanged || this.rekCalculated.isProcessedChanged || this.currentPayment.isProcessedChanged || this.maxCalculated.isProcessedChanged || this.normCalculated.isProcessedChanged || this.minCalculated.isProcessedChanged || this.calculatedPayment.isProcessedChanged;
    });
  }

  async savePercent() {
    //query
    this.percentSaving.value = true;

    // eslint-disable-next-line no-useless-catch
    try {
      const query = {
        offer_id: this.data.value.offer_id,
        min_perc: this.e_min_perc.processed,
        perc: this.e_perc.processed,
        old_perc: this.e_old_perc.processed,
        adv_perc: this.e_adv_perc.processed
      }

      const url = router.resolve({ name: 'api-good-percent', query}).href;
      await this.postData(url);
      const data = {...this.data.value};
      data.min_perc = this.e_min_perc.processed;
      data.perc = this.e_perc.processed;
      data.old_perc = this.e_old_perc.processed;
      data.adv_perc = this.e_adv_perc.processed;
      this.data.value = data;
      this.percentSaving.value = false;
    } catch (e) {
      this.percentSaving.value = false;
      throw e;
    }
  }

  async savePrice() {
    const data = {
      auto_action_enabled: "UNKNOWN",
      min_price: this.minCalculated.processed.toString(),
      old_price: this.maxCalculated.processed.toString(),
      price: this.normCalculated.processed.toString(),
      offer_id: this.data.value.offer_id,
      product_id: this.data.value.product_id
    }

    console.log(data);
  }
}

class DMPrices extends DMAbstract<DMPrice[]> {
  limit: number;
  limitValues: number[];
  #last_id?: string;

  offer_id: Ref<string[]>;
  product_id: Ref<(number | undefined)[]>;
  #dmVisibility: DMVisibility;
  visibility: Ref<string | undefined>;
  visibilityAlias: Ref<string>;
  #preset: DMPricePreset;
  #urlTransformer: (url: string) => string;

  constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string,
    preset: DMPricePreset,
    dmVisibility: DMVisibility
  ) {
    super(onChange, urlTransformer);
    this.#urlTransformer = urlTransformer;
    this.limit = 5;
    this.offer_id = ref([]);
    this.product_id =ref([]);
    this.visibility = ref(undefined);
    this.limitValues = [1, 5, 10, 20, 30];
    this.#dmVisibility = dmVisibility;
    this.visibilityAlias = computed(()=>{
      console.log(this.visibility)
      return this.visibility.value ? this.#dmVisibility.data![this.visibility.value] : 'Все типы';
    });
    this.#preset = preset
  }

  getAliasByVisibility(vis: string) {
    return this.#dmVisibility.data![vis]
  }

  getData() {
    this.data = [];
    this.#last_id = undefined;
    this.getNext().finally(()=>{});
  }

  async getNext() {
    const query = {offer_id: this.offer_id.value, product_id: this.product_id.value, visibility: this.visibility.value, limit: this.limit, last_id: this.#last_id}
    const url = router.resolve({ name: 'api-price', query}).href;
    const {data, last_id} = await this.getJson(url);
    const _data: DMPrice[] = data.map((i: TDMPrice) => new DMPrice(i, this.#preset, this.#urlTransformer));
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