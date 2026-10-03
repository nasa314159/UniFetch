import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/share', component: HomeView },
    ...(import.meta.env.DEV
      ? [
          {
            path: '/dev/instagram-probe',
            component: () => import('../dev/InstagramProbeView.vue'),
          },
        ]
      : []),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
