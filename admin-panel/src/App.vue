<script setup lang="ts">
  import { RouterView } from 'vue-router'
  import InfoSnackbar from "@/components/InfoSnackbar.vue";
</script>

<template>
    <v-app>
        <v-app-bar title="Admin Panel" elevation="3"></v-app-bar>
        <v-main class="ma-3">
            <router-view />
            <info-snackbar />
        </v-main>
    </v-app>
</template>

<style scoped>

</style>