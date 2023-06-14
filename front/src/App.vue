<template>
  <header :data-changes="dataSource.changes">
    <nav>
      <RouterLink to="/">Home</RouterLink>
      <RouterLink to="/form1">Form1</RouterLink>
    </nav>
  </header>

  <RouterView :changes="dataSource.changes" />
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { dataSource } from "@/data/data";
</script>

<style scoped lang="scss">
header {
  line-height: 1.5;
  max-height: 100vh;
  nav {
    width: 100%;
    text-align: center;
    margin-top: 2rem;
    a {
      margin-left: 20px;
    }
  }
}
</style>
