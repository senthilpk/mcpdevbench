<script setup lang="ts">
import { FileCode2, FlaskConical, ScanSearch, Server, SquareTerminal, Stethoscope } from '@lucide/vue';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarRail,
} from '@/renderer/components/ui/sidebar';

const futureItems = [
  { label: 'Inspector', icon: ScanSearch },
  { label: 'Console', icon: SquareTerminal },
  { label: 'Doctor', icon: Stethoscope },
  { label: 'Test suites', icon: FlaskConical },
];
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader class="border-b border-sidebar-border px-3 py-3">
      <div class="flex h-9 items-center gap-2 overflow-hidden px-1">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <FileCode2 class="size-4" aria-hidden="true" />
        </div>
        <div class="min-w-0 group-data-[collapsible=icon]:hidden">
          <h1 class="truncate text-sm font-semibold">MCPDevBench</h1>
          <p class="truncate text-[11px] text-muted-foreground">Systems workbench</p>
        </div>
      </div>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Primary">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton as-child is-active tooltip="Servers">
                  <RouterLink to="/" aria-current="page">
                    <Server aria-hidden="true" />
                    <span>Servers</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem v-for="item in futureItems" :key="item.label">
                <SidebarMenuButton disabled aria-disabled="true" :tooltip="`${item.label} (coming later)`">
                  <component :is="item.icon" aria-hidden="true" />
                  <span>{{ item.label }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter class="border-t border-sidebar-border px-3 py-3">
      <p class="truncate px-1 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">Local workspace</p>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
