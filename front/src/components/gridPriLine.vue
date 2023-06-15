<script setup lang="ts">
import { TDMPrice } from "@/data/model/price";
import { computed, Ref, ref } from "vue";

interface Props {
  item: TDMPrice;
  ind: number;
}
const props = defineProps<Props>();

const rounding = (val: number) => {
  return Math.ceil(val);
};

const old_perc: Ref<number> = ref(props.item.old_perc);
const perc: Ref<number> = ref(props.item.perc);
const min_perc: Ref<number> = ref(props.item.min_perc);
const adv_perc: Ref<number> = ref(props.item.adv_perc);

const currentPayment = computed((id: number)=>{
  // =marketing_seller_price-fbs_direct_flow_trans_max_amount-preset.sum_obtain-preset.sum_pack-maketing_seller_price*(preset.perc_ekv+preset.perc_mil+sales_percent+adv_perc)/100
  return id;
});

const calculatedPayment = computed(()=>{
  return 13;
});

</script>

<template>
  <div class="g-c g-r1">{{item.product_id}}</div>
  <div class="g-c g-r2">{{item.offer_id}}</div>
  <div class="g-c g-r3">{{item.name}}</div>
  <div class="g-c g-r4">{{rounding(item.marketing_price)}}</div>
  <div class="g-c g-r5">{{rounding(item.marketing_seller_price)}}</div>
  <div class="g-c g-r6">
    <div>{{currentPayment}}</div>
    <div>{{calculatedPayment}}</div>
  </div>
  <div class="g-c g-r7">{{rounding(item.incoming_price)}}</div>
  <div class="g-c g-r8">
    <div>{{rounding(item.old_price)}}</div>
    <div>calc</div>
    <div>
      <input type="number" size="5" v-model="old_perc">
    </div>
  </div>
  <div class="g-c g-r9">
    <div>{{rounding(item.price)}}</div>
    <div>calc</div>
    <div>
      <input type="number" v-model="perc">
    </div>
  </div>
  <div class="g-c g-r10">
    <div>{{rounding(item.min_price)}}</div>
    <div>calc</div>
    <div>
      <input type="number" v-model="min_perc">
    </div>
  </div>
  <div class="g-c g-r11">
    <div>calc</div>
    <div>calc</div>
    <div>{{item.sales_percent}}</div>
  </div>
  <div class="g-c g-r12">
    <div></div>
    <div>{{item.fbs_direct_flow_trans_max_amount}}</div>
    <div></div>
  </div>
  <div class="g-c g-r13">
    <div>calc</div>
    <div>calc</div>
    <div>
      <input type="number" v-model="adv_perc">
    </div>
  </div>
  <div class="g-c g-r14">
    {{ind+1}}
  </div>
</template>

<style scoped lang="scss">
input {
  font-size: 20px;
  max-width: 75px;
  padding: 5px;
}
</style>