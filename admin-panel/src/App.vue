<script setup lang="ts">
  import { RouterView } from 'vue-router'
</script>

<template>
    <v-app>
        <v-app-bar title="Admin Panel" elevation="3"></v-app-bar>
        <v-main class="ma-3">
            <router-view />
        </v-main>
    </v-app>
</template>

<style scoped>

</style>