<template>
  <template v-if="dataSource.initialized.value === true">
    <header :data-changes="dataSource.changes.value">
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/form1">Form1</RouterLink>
      </nav>
    </header>

    <RouterView :key="dataSource.changes.value" />
  </template>
  <aside v-else-if="dataSource.initialized.value === false">
    Ошибка инициализации приложения:
    <div>{{dataSource.initializationError}}</div>
    Обратитесь к администратору.
  </aside>
  <aside v-else>
    Инициализация приложения...
  </aside>
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { dataSource } from "@/data/data";
</script>

<style scoped lang="scss">
aside{
  width: 100%;
  height: 100vw;
  display: flex;
  flex-flow: column;
  justify-content: center;
  align-items: center;
  div {
    margin: 20px;
    padding: 20px;
    color: var(--error)
  }
}
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
