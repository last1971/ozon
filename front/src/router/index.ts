import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: {
        title: 'Calculators'
      },
    },
    {
      path: '/form1',
      name: 'form1',
      meta: {
        title: 'Form 1'
      },
// @ts-ignore
      component: () => import('../views/form-1.vue')
    },

// API BLOCK ---------------------

    {
      path: '/api/price',
      name: 'api-price',
      redirect: '/'
    },
    {
      path: '/api/product/visibility',
      name: 'api-product-visibility',
      redirect: '/api/price'
    },

  ]
});

router.beforeEach((toRoute, fromRoute, next) => {
  // @ts-ignore
  window.document.title = toRoute.meta?.title ?? 'Calculators';

  next();
})

export default router
