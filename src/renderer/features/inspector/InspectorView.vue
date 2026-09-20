<script setup lang="ts">
import ServerInspector from '@/renderer/features/inspector/ServerInspector.vue';

defineProps<{ profileId: string }>();
</script>

<template>
  <ServerInspector :profile-id="profileId" />
</template>
