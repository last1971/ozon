<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
    isOpen: boolean,
    message: string,
}>()

const emit = defineEmits(['close'])

const open = ref(false);
watch(() => props.isOpen, () => { open.value = props.isOpen });

const toggle = () => {
    emit('close', false)
}
</script>

<template>
    <v-snackbar v-model="open" color="error" >
        {{ props.message }}
        <template v-slot:actions>
            <v-btn
                icon="mdi-close"
                @click="toggle"
            />
        </template>
    </v-snackbar>
</template>

<style scoped>

</style>