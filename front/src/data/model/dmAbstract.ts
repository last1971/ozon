import type { Ref } from "vue";
import { ref } from "vue";

abstract class DMAbstract<T> {
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

  isLoading: Ref<boolean>;

  readonly #onChange: () => void;
  urlTransformer: (url: string) => string;

  protected constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string,
    options?: {data?: T}
  ) {
    this.isLoading = ref(false);
    this.#onChange = onChange;
    this.urlTransformer = urlTransformer;
    if (options?.data) this.data = options.data;
  }

  abstract getData(...args: any[]): void;

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
}

export {
  DMAbstract
}
