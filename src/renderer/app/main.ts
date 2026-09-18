import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from '@/renderer/app/App.vue';
import { router } from '@/renderer/app/router';
import '@/renderer/app/styles.css';

createApp(App).use(createPinia()).use(router).mount('#app');
