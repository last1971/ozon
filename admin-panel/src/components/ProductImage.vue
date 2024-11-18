<script setup lang="ts">

// Описание пропсов
defineProps({
    image: {
        type: String,
        required: true,
    },
    alt: {
        type: String,
        default: 'Картинка',
    }
});
</script>

<template>
    <v-hover v-slot="{ isHovering, props }">
        <img
            :src="image"
            :alt="alt"
            :style="{
                width: '50px',
                height: '50px',
                transition: 'transform 0.3s ease',
                transform: isHovering ? 'scale(5)' : 'scale(1)',
                zIndex: isHovering ? 10 : 1,
                position: isHovering ? 'relative' : 'static',
                transformOrigin: 'left center',
            }"
            v-bind="props"
        />
    </v-hover>
</template>

<style scoped>

</style>