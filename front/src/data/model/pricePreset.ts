import { DMAbstract } from "@/data/model/dmAbstract";
import router from "@/router";

type TDMPricePreset = {
  perc_min: number,
  perc_nor: number,
  perc_max: number,
  perc_ekv: number,
  perc_mil: number,
  sum_obtain: number,
  sum_pack: number
}

class DMPricePreset extends DMAbstract<TDMPricePreset> {
  constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string
  ) {
    super(onChange, urlTransformer);
  }

  async getData() {
    const url = router.resolve({ name: 'api-price-preset'}).href;
    this.data = await this.getJson(url);
  }
}

export {
  DMPricePreset
}

export type {
  TDMPricePreset
}