import { createRouter, createWebHashHistory } from 'vue-router';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: DashboardView }],
});
