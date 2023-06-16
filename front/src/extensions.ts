import { computed, ref } from "vue";
import type { Ref, ComputedRef } from "vue";

class ExtRef<T> {
  #ref: Ref<T>
  processor: (val: T) => T;
  get value(): T {
    return this.#ref.value
  }
  set value(val: T) {
    this.#ref.value = val
  }
  get processed(): T {
    return this.processor(this.value);
  }
  set processed(val: T) {
    this.#ref.value = this.processor(val)
  }

  constructor(processor: (val: T) => T, value: T) {
    this.processor = processor;
    this.#ref = ref<T>(value) as Ref<T>;
  }
}

class ExtComputedRef<T> {
  #ref: ComputedRef<T>
  initialValue?: T;
  #initialProcessed?: T;
  processor: (val: T) => T;
  get value(): T {
    const val = this.#ref.value;
    this.initialValue ??= val;
    return val;
  }
  get processed(): T {
    const val = this.processor(this.value);
    this.#initialProcessed ??= val;
    return val;
  }
  get isValueChanged(): boolean {
    return this.value !== this.initialValue;
  }
  get isProcessedChanged(): boolean {
    return this.processed !== this.#initialProcessed;
  }

  constructor(processor: (val: T) => T, refSource: (val: T) => T) {
    this.processor = processor;
    this.#ref = computed<T>(refSource) as ComputedRef<T>
  }
}

const upToHund: (val:  number)=>number = (val) => {
  try {
    const _val = parseFloat(val.toFixed(2));
    if (!isNaN(_val)) val = _val;
  } catch (e) {}
  return val;
}

const stringToNumberCorrection = <T>(data: Record<string, any>, excludeCheck: string[]) => {
  const _data = Object.entries(data);
  const result: Record<string, any> = {}
  for (const [key, value] of _data) {
    if (typeof value === 'string' && !excludeCheck.includes(key)) {
      const match = /^(?:\s+)?(\d+)(?:([.,])(\d+))?(?:\s+)?$/g.exec(value);
      if (match) {
        let _val = parseInt(match[1]);
        if (match[3]) _val += parseInt(match[3]) / (10 ^ match[3].length);
        result[key] = _val;
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export {
  ExtComputedRef,
  ExtRef,
  upToHund,
  stringToNumberCorrection
};
