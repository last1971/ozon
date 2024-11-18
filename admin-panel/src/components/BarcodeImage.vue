<script setup lang="ts">

// Описание пропсов
defineProps({
    barcode: {
        type: String,
        required: true,
    },
    url: {
        type: String,
        required: true,
    },
    barcodeType: {
        type: String,
        required: true,
    },
});
</script>

<template>
    <img
        :src="`${url}/api/label/generate?bcid=${barcodeType}&text=${barcode}&height=10&width=30`"
        :alt="barcode"
        style="width: 200px; height: 60px;"
    />
</template>

<style scoped>

</style>