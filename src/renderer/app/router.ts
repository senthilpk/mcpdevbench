import { createRouter, createWebHashHistory } from 'vue-router';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';
import InspectorView from '@/renderer/features/inspector/InspectorView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/servers/:profileId', component: InspectorView, props: true },
  ],
});
