import router from "@/router";
import { env } from "@/env";
import { DMVisibility } from "@/data/model/visibility";
import type { Ref } from "vue";
import { ref } from "vue";
import { DMPrice } from "@/data/model/price";

class Data {
  dev: boolean;
  initialized: Ref<boolean | undefined>;
  urlTransformer: (url: string) => string;
  dmVisibility?: DMVisibility;
  dmPrice?: DMPrice;
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

  refresh = () => {
    this.changes.value++;
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

  sleep(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }
  
  async init() {
    this.dmVisibility = new DMVisibility(this.refresh, this.urlTransformer);
    await this.dmVisibility.getData();
    this.dmPrice = new DMPrice(this.refresh, this.urlTransformer);

    // this.sleep(2000).then(()=>{this.dmVisibility!.data = {}})
  }
}

const dev = import.meta.env.MODE === 'development'
const dataSource = new Data({dev});

export {
  Data,
  dataSource
}