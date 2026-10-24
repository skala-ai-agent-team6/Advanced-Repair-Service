<script setup lang="ts">
/* 수리 작업 (기사 메뉴) — 작업할 수리 건을 고르면 진단 리포트로 이동.
 * 최근에 본 건이 있으면 맨 위에 "이어서 보기" */
import { computed, onMounted, ref } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import RecentWorkList from '@/components/repair/RecentWorkList.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { repairApi, toErrorMessage } from '@/api'
import { lastRepairId } from '@/utils/lastRepair'
import { repairId } from '@/utils/format'
import type { Repair } from '@/types'
import { PAGE_LABEL } from '@/constants/menus'

const items = ref<Repair[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const last = lastRepairId()

async function load() {
  loading.value = true
  error.value = null
  try {
    // 출장기사 · 센터 수리자 모두 자신에게 배정된 건
    items.value = (await repairApi.list({ scope: 'assigned' })).items
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const lastRepair = computed(() => items.value.find((r) => r.id === last))
/** 진행 중인 건 (최근 갱신 순) — '이어서 보기'로 이미 보이는 건은 목록에서 빼서 같은 이동 버튼이 두 번 나오지 않게 */
const active = computed(() =>
  items.value
    .filter((r) => !['APPROVED', 'CLOSED', 'CANCELLED'].includes(r.status) && r.id !== lastRepair.value?.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ PAGE_LABEL.work }}</h1>
        <p class="sub">작업할 수리 건을 고르면 진단 리포트로 이동합니다.</p>
      </div>
    </div>

    <RouterLink v-if="lastRepair" :to="`/repairs/${lastRepair.id}/diagnosis`" class="card continue">
      <span>
        <span class="faint">최근에 본 작업</span>
        <strong>{{ repairId(lastRepair.id) }} · {{ lastRepair.product.model }} 이어서 보기</strong>
      </span>
      <ArrowRight :size="20" />
    </RouterLink>

    <section class="card">
      <div class="card-head"><h2>진행 중인 작업</h2><span class="faint">{{ active.length }}건</span></div>
      <div v-if="loading && !items.length" class="card-body"><SkeletonBlock :lines="4" :height="44" /></div>
      <StateView v-else-if="error" state="error" :message="error" compact @retry="load" />
      <StateView v-else-if="!active.length" state="empty" title="진행 중인 작업이 없습니다" compact />
      <RecentWorkList v-else :items="active" />
    </section>
  </div>
</template>

<style scoped>
.continue {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
  color: var(--text);
  text-decoration: none;
  background: var(--blue-50);
}
.continue span {
  display: grid;
}
.continue svg {
  color: var(--primary);
}
</style>
