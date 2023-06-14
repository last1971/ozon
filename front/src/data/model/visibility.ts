import { DMAbstract } from "@/data/model/dmAbstract";
import router from "@/router";

export class DMVisibility extends DMAbstract<Record<string, any>> {
  constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string
  ) {
    super(onChange, urlTransformer)
  }

  async getData() {
    const url = router.resolve({ name: 'api-product-visibility'}).href;
    this.data = await this.getJson(url);
  }
}
