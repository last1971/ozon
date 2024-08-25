<script setup lang="ts">
import Tariff from "@/components/Tariff.vue";
import Articles from "@/components/Articles.vue";
import Prices from "@/components/Prices.vue";
import { ref } from "vue";
const tab = ref('prices');
</script>

<template>
    <v-card>
        <v-tabs
            bg-color="primary"
            v-model="tab"
        >
            <v-tab value="prices">Цены</v-tab>
            <v-tab value="wb-marketplace">WB маркетплейс</v-tab>
        </v-tabs>

        <v-card-text>
            <v-tabs-window v-model="tab">
                <v-tabs-window-item value="prices">
                    <Tariff class="pa-2"/>
                    <v-divider :thickness="5" />
                    <Articles class="pa-2" />
                    <v-divider :thickness="5" />
                    <Prices class="pa-2" />
                </v-tabs-window-item>

                <v-tabs-window-item value="wb-marketplace">
                    Two
                </v-tabs-window-item>
            </v-tabs-window>
        </v-card-text>
    </v-card>
</template>
