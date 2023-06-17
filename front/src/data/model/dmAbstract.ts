import type { Ref } from "vue";
import { ref } from "vue";

abstract class DMApiMethods {
  isLoading: Ref<boolean>;
  urlTransformer: (url: string) => string;

  protected constructor(urlTransformer: (url: string) => string) {
    this.isLoading = ref(false);
    this.urlTransformer = urlTransformer;
  }

  async getJson(url: string) {
    this.isLoading.value = true;

    try {
      const resp = await  fetch(this.urlTransformer(url));
      this.isLoading.value = false;
      return resp.json();
    } catch (e) {
      this.isLoading.value = false;
      throw e;
    }
  }

  async postData(url: string, data?: Record<string, any>) {
    this.isLoading.value = true;
    console.log(url);
    try {
      const init: RequestInit = {
        method: 'POST',
      }

      if (data) {
        init.headers = {
          'Content-Type': 'application/json'
        };
        init.body = JSON.stringify(data);
      }

      const resp = await  fetch(this.urlTransformer(url), init);
      this.isLoading.value = false;
      return resp.text();
    } catch (e) {
      this.isLoading.value = false;
      throw e;
    }
  }
}

abstract class DMAbstract<T> extends DMApiMethods{
  #data?: T;
  get data() {
    return this.#data
  }
  set data(val: T | undefined) {
    this.#data = val;
    this.#onChange();
  }

  changed() {
    this.#onChange();
  }


  readonly #onChange: () => void;

  protected constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string,
    options?: {data?: T}
  ) {
    super(urlTransformer);
    this.#onChange = onChange;
    if (options?.data) this.data = options.data;
  }

  abstract getData(...args: any[]): void;

}

export {
  DMAbstract,
  DMApiMethods
}
