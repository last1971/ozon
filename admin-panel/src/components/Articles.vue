<script setup lang="ts">
    import { articulesStore } from "@/stores/articules";
    import { ref } from "vue";
    import { priceStore } from "@/stores/prices";
    import { storeToRefs } from "pinia";
    function addArticule() {
      articulesStore().push('');
    }
    function deleteArticle(index: number) {
        articulesStore().delete(index)
    }
    async function getPrices() {
        await priceStore().get()
    }
    const articules = ref(articulesStore().articules)
    const { isLoadingPrices } = storeToRefs(priceStore())
</script>

<template>
    <v-row>
        <v-col cols="3">
            <v-alert text="Артикулы:"></v-alert>
        </v-col>
        <v-col cols="3"  v-for="index in articules.length">
            <v-text-field
                variant="underlined"
                v-model="articules[index-1]"
                append-icon="mdi-delete"
                @click:append="deleteArticle(index-1)"
            />
        </v-col>
        <v-col cols="3">
            <v-btn @click="addArticule"  icon="mdi-plus"></v-btn>
            <v-btn
                v-if="articules.length"
                icon="mdi-send"
                class="float-right"
                @click="getPrices"
                :loading="isLoadingPrices"
            ></v-btn>
        </v-col>
    </v-row>
</template>

<style scoped>

</style>