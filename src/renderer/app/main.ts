import { createPinia } from 'pinia';
import { createApp } from 'vue';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import App from '@/renderer/app/App.vue';
import { router } from '@/renderer/app/router';
import '@/renderer/styles/base.css';

createApp(App).use(createPinia()).use(router).mount('#app');
