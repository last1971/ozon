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

<style id="variables">
:root {
  --color-text: #111;
  --color-background: #eee;
  --error: #f39;
  --border-color: #ccc;
  --grid-background: #bcd;
  --header-background: #def;
  --cell-background: #fff;
  --calculated-background: #ff02;
  --changed-border-color: #69cc;
  --transparent: #fff0;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #eee;
    --color-background: #111;
    --border-color: #333;
    --grid-background: #123;
    --header-background: #003;
    --cell-background: #000;
    --changed-border-color: #fc96;
  }
}
</style>

<style id="main">
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  font-weight: normal;
}

html {
  color-scheme: dark light;
  scroll-behavior: inherit;
}

body {
  min-height: 100vh;
  max-width: 100vw;
  color: var(--color-text);
  background: var(--color-background);
  transition: color 0.5s, background-color 0.5s;
  line-height: 1.6;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
  Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  font-size: 18px;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

main {
  max-width: 100%;
}

#app {
  margin: 0 auto;
  padding: 10px;

  font-weight: normal;
}

a,
.green {
  text-decoration: none;
  color: hsla(160, 100%, 37%, 1);
  transition: 0.4s;
}

@media (hover: hover) {
  a:hover {
    background-color: hsla(160, 100%, 37%, 0.2);
  }
}

input, button {
  font-size: 20px;
  padding: 5px;
}

.grid {
  display: grid;
  grid-gap: 2px;
  margin: 50px 0;
  padding: 5px;
  border: solid 1px var(--border-color);
  background-color: var(--grid-background);
  border-radius: 10px;

  .g-ce {
    background-color: var(--cell-background);
    padding: 5px;
    display: flex;
    flex-flow: column;
    justify-content: start;
    align-items: center;
    border-radius: 4px;
    &.g-h {
      background-color: var(--header-background);
      font-weight: 700;
    }
  }
}

</style>

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
