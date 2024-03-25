<script setup lang="ts">
  import { RouterLink, RouterView } from 'vue-router'
</script>

<template>

<v-app class="full-screen">
      <v-app-bar >
        <v-app-bar-title>Admin Panel</v-app-bar-title>
      </v-app-bar>

    <v-main  >
      <router-view />
    </v-main>
</v-app>
</template>

<style scoped>
.full-screen {
    height: 100%;
    width: max-content;
    margin: 0;
}
</style>
