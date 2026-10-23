<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, LogOut, Menu, RotateCcw } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import { ROLE_LABEL } from '@/constants/status'
import { formatRelative } from '@/utils/format'
import { USE_MOCK } from '@/api'
import { resetDb } from '@/mocks/db'

defineEmits<{ 'toggle-nav': [] }>()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const noti = useNotificationStore()
const open = ref(false)

const title = computed(() => route.meta.title ?? '')
/** 기사: 오른쪽에 이름 + 기사 유형 배지만 (로고는 사이드바 맨 위, 품질 담당자는 기존 그대로) */
const isTech = computed(() => auth.role === 'TECHNICIAN')
const TYPE_LABEL = { FIELD: '출장', CENTER: '센터' } as const

async function go(id: string, link?: string) {
  await noti.read(id)
  open.value = false
  if (link) void router.push(link)
}
async function logout() {
  await auth.logout()
  void router.push('/login')
}
function reset() {
  if (confirm('데모 데이터를 처음 상태로 되돌릴까요?')) resetDb()
}
</script>

<template>
  <header class="topbar">
    <button class="btn btn-ghost menu" type="button" aria-label="메뉴 열기" @click="$emit('toggle-nav')"><Menu :size="24" /></button>
    <!-- 기사: 로고는 사이드바 맨 위로 옮김 → 상단바에는 오른쪽 사용자 정보만 -->
    <h1 v-if="!isTech" class="title">{{ title }}</h1>
    <div class="spacer" />

    <button v-if="USE_MOCK" class="btn btn-ghost btn-sm demo" type="button" title="Mock 데이터 초기화" @click="reset">
      <RotateCcw :size="16" /> <span>데모 초기화</span>
    </button>

    <div class="noti">
      <button class="btn btn-ghost bell" type="button" :aria-label="`알림 ${noti.unread}건`" :aria-expanded="open" @click="open = !open">
        <Bell :size="22" />
        <span v-if="noti.unread" class="dot">{{ noti.unread }}</span>
      </button>
      <div v-if="open" class="panel card" role="menu">
        <div class="row between ph">
          <strong>알림</strong>
          <button class="btn btn-ghost btn-sm" type="button" @click="noti.readAll()">모두 읽음</button>
        </div>
        <p v-if="!noti.items.length" class="faint empty">새 알림이 없습니다.</p>
        <button v-for="n in noti.items" :key="n.id" type="button" class="nitem" :class="{ unread: !n.read }" role="menuitem" @click="go(n.id, n.link)">
          <span class="nt">{{ n.title }}</span>
          <span class="nb">{{ n.body }}</span>
          <span class="faint">{{ formatRelative(n.at) }}</span>
        </button>
      </div>
      <div v-if="open" class="click-away" @click="open = false" />
    </div>

    <div v-if="isTech" class="user">
      <strong class="tech-name">{{ auth.user?.name }}</strong>
      <span v-if="auth.technicianType" class="badge tech-type" :class="auth.technicianType === 'FIELD' ? 'tone-warning' : 'tone-info'">{{ TYPE_LABEL[auth.technicianType] }}</span>
    </div>
    <div v-else class="user">
      <span class="badge tone-info role">{{ auth.user ? ROLE_LABEL[auth.user.role] : '' }}</span>
      <span class="name">
        <strong>{{ auth.user?.name }}</strong>
        <small>{{ auth.user?.branch }}</small>
      </span>
    </div>
    <button class="btn btn-sm logout" type="button" aria-label="로그아웃" @click="logout"><LogOut :size="18" /> <span class="lo-txt">로그아웃</span></button>
  </header>
</template>

<style scoped>
.tech-name {
  white-space: nowrap;
}
.tech-type {
  font-size: var(--fs-xs);
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border);
}
.title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--navy-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu {
  display: none;
  padding: 0 10px;
}
.demo {
  color: var(--text-3);
}
.noti {
  position: relative;
}
.bell {
  position: relative;
  padding: 0 12px;
}
.dot {
  position: absolute;
  top: 6px;
  right: 4px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  display: grid;
  place-items: center;
}
.panel {
  position: absolute;
  right: 0;
  top: 54px;
  width: 380px;
  max-height: 480px;
  overflow: auto;
  z-index: 60;
  box-shadow: var(--shadow-lg);
  padding: 6px;
}
.click-away {
  position: fixed;
  inset: 0;
  z-index: 50;
}
.ph {
  padding: 8px 10px;
}
.empty {
  padding: 16px;
}
.nitem {
  display: grid;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 12px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
}
.nitem:hover {
  background: var(--navy-50);
}
.nitem.unread {
  background: #fffaf2;
  box-shadow: inset 3px 0 0 #f0a33a;
}
.nt {
  font-weight: 700;
}
.nb {
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.user {
  display: flex;
  align-items: center;
  gap: 10px;
}
.name {
  display: grid;
  line-height: 1.25;
}
.name small {
  color: var(--text-3);
  font-size: var(--fs-xs);
}
@media (max-width: 1100px) {
  .menu {
    display: inline-flex;
  }
  .topbar {
    padding: 0 12px;
  }
}
@media (max-width: 860px) {
  .role,
  .demo span,
  .name small {
    display: none;
  }
}
/* 휴대폰: 이름이 한 글자씩 줄바꿈되지 않게 숨김 (역할·이름은 홈 화면 인사말에 표시) */
@media (max-width: 480px) {
  .name,
  .tech-name,
  .lo-txt {
    display: none;
  }
  .logout {
    padding: 0 12px;
  }
  /* 데모 초기화(Mock 전용 도구)는 넓은 화면에서만 */
  .demo {
    display: none;
  }
  .topbar {
    gap: 6px;
  }
}
</style>
