import router from "@/router";
import { env } from "@/env";
import { DMVisibility } from "@/data/model/visibility";
import type { Ref } from "vue";
import { ref } from "vue";
import { DMPrices } from "@/data/model/price";
import { DMPricePreset } from "@/data/model/pricePreset";

class Data {
  dmVisibility?: DMVisibility;
  dmPrice?: DMPrices;
  dmPricePreset?: DMPricePreset;

  dev: boolean;
  initialized: Ref<boolean | undefined>;
  urlTransformer: (url: string) => string;
  appInitialized?: true;
  changes: Ref<number>;
  initializationError?: string;

  constructor(s: {dev?: boolean}) {
    this.initialized = ref(undefined)
    this.changes = ref(0);
    this.dev = !!s.dev;
    this.urlTransformer = this.dev
      ? (url: string) => `${env.apiDevPrefix}${url}`
      : (url: string) => url.replace(/^\/price-admin/g, '');
    this.appInitChecker();
  }

  async init() {
    this.dmVisibility = new DMVisibility(this.refresh, this.urlTransformer);
    await this.dmVisibility.getData();
    this.dmPricePreset = new DMPricePreset(this.refresh, this.urlTransformer);
    await this.dmPricePreset.getData();
    this.dmPrice = new DMPrices(this.refresh, this.urlTransformer, this.dmPricePreset);

    await this.sleep(500); // интеллектуальная пауза))
  }

  appInitChecker() {
    this.sleep(100)
      .then(()=>{
        try {
          const check = router;
          this.appInitialized = true;
          this.init()
            .then(() => (this.initialized.value = true))
            .catch((err) => {
              this.initializationError = err;
              this.initialized.value = false;
              console.log(err);
            })
        } catch (e) {
          this.appInitChecker()
        }
      });
  }

  refresh = () => {
    this.changes.value++;
  }


  sleep(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }
}

const dev = import.meta.env.MODE === 'development'
const dataSource = new Data({dev});

export {
  Data,
  dataSource
}