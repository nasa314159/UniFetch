import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { canonicalProductionUrl } from './canonical-origin';
import './styles/main.css';

const canonical = canonicalProductionUrl(window.location.href);
if (canonical) window.location.replace(canonical);
else createApp(App).use(createPinia()).use(router).mount('#app');
