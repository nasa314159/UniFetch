import type { RouteRecordRaw } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import ExtensionView from '../views/ExtensionView.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', component: HomeView },
  { path: '/share', component: HomeView },
  { path: '/extension', component: ExtensionView },
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/instagram-probe',
          component: () => import('../dev/InstagramProbeView.vue'),
        },
      ]
    : []),
  { path: '/:pathMatch(.*)*', redirect: '/' },
];
