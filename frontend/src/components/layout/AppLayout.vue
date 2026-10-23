<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import { useNotificationStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const navOpen = ref(false)
const notifications = useNotificationStore()
const auth = useAuthStore()

watch(() => route.fullPath, () => (navOpen.value = false))
onMounted(() => notifications.startPolling())
onBeforeUnmount(() => notifications.stopPolling())
</script>

<template>
  <div class="shell" :class="{ 'nav-open': navOpen, tech: auth.role === 'TECHNICIAN' }">
    <a href="#main" class="skip">본문으로 건너뛰기</a>
    <AppSidebar class="side" @navigate="navOpen = false" />
    <div class="scrim" @click="navOpen = false" />
    <div class="main-col">
      <AppTopbar @toggle-nav="navOpen = !navOpen" />
      <main id="main" tabindex="-1">
        <RouterView v-slot="{ Component, route: r }">
          <component :is="Component" :key="r.path" />
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  min-height: 100vh;
}
/* 기사: 좁은 세로 메뉴 */
.shell.tech {
  grid-template-columns: var(--rail-w) 1fr;
}
.side {
  position: sticky;
  top: 0;
  height: 100vh;
}
.main-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
main {
  flex: 1;
  outline: none;
}
.skip {
  position: absolute;
  left: -999px;
  top: 8px;
  z-index: 200;
  background: var(--navy-800);
  color: #fff;
  padding: 10px 16px;
  border-radius: var(--radius);
}
.skip:focus {
  left: 8px;
}
.scrim {
  display: none;
}
@media (max-width: 1100px) {
  .shell,
  .shell.tech {
    grid-template-columns: 1fr;
  }
  .side {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 80;
    width: var(--sidebar-w);
    transform: translateX(-100%);
    transition: transform 0.2s;
    box-shadow: var(--shadow-lg);
  }
  .nav-open .side {
    transform: none;
  }
  .tech .side {
    width: var(--rail-w);
  }
  .nav-open .scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(15, 29, 66, 0.35);
    z-index: 70;
  }
}
</style>
