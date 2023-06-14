abstract class DMAbstract<T> {
  #data?: T;
  get data() {
    return this.#data
  }
  set data(val: T | undefined) {
    this.#data = val;
    this.#onChange();
  }

  readonly #onChange: () => void;
  urlTransformer: (url: string) => string;

  protected constructor(
    onChange: () => void,
    urlTransformer: (url: string) => string,
    options?: {data?: T}
  ) {
    this.#onChange = onChange;
    this.urlTransformer = urlTransformer;
    if (options?.data) this.data = options.data;
  }

  abstract getData(...args: any[]): void;

  async getJson(url: string) {
    const resp = await  fetch(this.urlTransformer(url));
    return resp.json();
  }
}

export {
  DMAbstract
}
