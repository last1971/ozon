<script setup lang="ts">
import { ref, watch } from "vue";

    const props = defineProps<{
        isOpen: boolean,
        message: string,
    }>()

    const emit = defineEmits(['close'])

    const open = ref(false);
    watch(() => props.isOpen, () => { open.value = props.isOpen });

    const toggle = (v: boolean) => {
        emit('close', v)
    }
</script>

<template>
    <v-snackbar v-model="open" color="success" :timeout="2000" @update:model-value="toggle" >
        {{ props.message }}
    </v-snackbar>
</template>

<style scoped>

</style>