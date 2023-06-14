import router from "@/router";
import { env } from "@/env";
import { DMVisibility } from "@/data/model/visibility";
import type { Ref } from "vue";
import { ref } from "vue";

class Data {
  dev: boolean;
  initialized?: boolean;
  urlTransformer: (url: string)=>string;
  #dmVisibility?: DMVisibility;
  get dmVisibility(): DMVisibility | undefined {
    return this.#dmVisibility;
  }
  set dmVisibility(val: DMVisibility | undefined) {
    this.#dmVisibility = val;
    this._changes.value++;
  }
  appInitialized?: true;
  _changes: Ref<number>;
  get changes(): number {
    return this._changes.value
  }

  constructor(s: {dev?: boolean}) {
    this._changes = ref(0);
    this.dev = !!s.dev;
    this.urlTransformer = this.dev
      ? (url: string) => `${env.apiDevPrefix}${url}`
      : (url: string) => url.replace(/^\/price-admin/g, '');
    this.appInitChecker();
    this.sleep(2000)
      .then(()=>{
        this.dmVisibility!.data.ALL = '123';
        this.refresh();
        console.log(this._changes.value, this.dmVisibility)
      });
    this.sleep(2000)
      .then(()=>{
        this.dmVisibility = {};
        this.refresh();
        console.log(this._changes.value, this.dmVisibility)
      })
  }

  refresh(){
    this._changes.value++;
  }

  appInitChecker() {
    this.sleep(100)
      .then(()=>{
        try {
          const check = router;
          this.appInitialized = true;
          this.init()
            .then(() => (this.initialized = true))
            .catch((err) => {
              this.initialized = false;
              console.log(err);
            })
        } catch (e) {
          this.appInitChecker()
        }
      });
  }

  sleep(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }
  
  async init() {
    const data = await this.getVisibility();
    this.dmVisibility = new DMVisibility(data);
    console.log(this.dmVisibility)
  }

  async #getJson(url: string) {
    const resp = await  fetch(this.urlTransformer(url));
    return resp.json();
  }


  async getVisibility() {
    const url = router.resolve({ name: 'api-product-visibility'}).href;
    return this.#getJson(url);
  }

  async getPrice(query: {limit: number, offer_id?: string[], product_id?: number[], visibility?: string, last_id?: string}) {
    const url = router.resolve({ name: 'api-price', query }).href;
    console.log(url);
    const response = await fetch('http://10.59.0.13:3002/api/price?limit=10');
    const data = await response.json();
    console.log(data);
    return data;
  }

  test() {
    return 'test'
  }
}

const dev = import.meta.env.MODE === 'development'
const dataSource = new Data({dev});

export {
  Data,
  dataSource
}