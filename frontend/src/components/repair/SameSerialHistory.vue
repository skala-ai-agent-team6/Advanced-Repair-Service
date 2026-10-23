<script setup lang="ts">
/* 같은 시리얼 번호로 접수된 다른 수리 건. 재입고 제품은 시리얼이 겹치므로 수리 ID 로 구분해 보여준다. */
import { computed, ref, watch } from 'vue'
import { ExternalLink, History, Info } from 'lucide-vue-next'
import RepairStatusBadge from '@/components/common/RepairStatusBadge.vue'
import { repairApi } from '@/api'
import type { Repair } from '@/types'
import { formatDate, repairId } from '@/utils/format'

/** standalone: 단독 화면(수리 이력)에서 쓸 때 불러오는 중·결과 없음도 표시 (기본은 결과가 있을 때만 보임) */
const props = defineProps<{ serial: string; excludeId?: number; compact?: boolean; newTab?: boolean; standalone?: boolean }>()

const items = ref<Repair[]>([])
const loading = ref(false)
let seq = 0

async function load(serial: string) {
  const mine = ++seq
  items.value = []
  if (!serial) return
  loading.value = true
  try {
    // 기사는 자신에게 배정된 건 중에서 (품질 담당자는 전체)
    const res = await repairApi.list({ keyword: serial, scope: 'assigned' })
    if (mine !== seq) return
    // 키워드 검색은 부분 일치이므로 시리얼이 정확히 같은 건만 남긴다
    items.value = res.items.filter((r) => r.product.serialNumber === serial)
  } catch {
    /* 보조 정보라 조회 실패 시 표시하지 않음 */
  } finally {
    if (mine === seq) loading.value = false
  }
}
watch(() => props.serial, (s) => void load(s.trim().toUpperCase()), { immediate: true })

const others = computed(() =>
  items.value.filter((r) => r.id !== props.excludeId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
)
</script>

<template>
  <p v-if="standalone && loading" class="card card-pad faint" role="status">수리 이력을 찾고 있어요…</p>
  <p v-else-if="standalone && !others.length" class="card card-pad faint" role="status">등록된 수리 이력이 없습니다. <span class="mono">({{ serial }})</span></p>
  <section v-else-if="!loading && others.length" class="same-serial" :class="compact ? 'compact' : 'card card-pad'" aria-labelledby="same-serial-title">
    <h3 id="same-serial-title" class="title">
      <History :size="18" /> 같은 시리얼의 다른 수리 건 <span class="badge tone-neutral">{{ others.length }}건</span>
    </h3>
    <p class="faint note"><Info :size="14" /> 시리얼 번호는 재접수 시 겹칠 수 있어, 수리 건은 수리 ID로 따로 구분됩니다.</p>
    <ul class="list">
      <li v-for="r in others" :key="r.id">
        <!-- 접수 작성 중에는 입력 내용을 잃지 않도록 새 탭으로 연다 -->
        <a v-if="newTab" :href="`/repairs/${r.id}/diagnosis`" target="_blank" rel="noopener" class="mono rid" :aria-label="`수리 ID ${repairId(r.id)} (새 탭에서 열기)`">
          {{ repairId(r.id) }} <ExternalLink :size="14" aria-hidden="true" />
        </a>
        <RouterLink v-else :to="`/repairs/${r.id}/diagnosis`" class="mono rid">{{ repairId(r.id) }}</RouterLink>
        <span class="faint nowrap">{{ formatDate(r.receivedAt) }}</span>
        <span class="sym" :title="r.symptom">{{ r.symptom }}</span>
        <RepairStatusBadge :status="r.status" :failed="!!r.analysisError" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.same-serial {
  display: grid;
  gap: 8px;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-md);
}
.note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.list li {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
.compact .list li {
  padding: 6px 0;
}
.rid {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
  color: var(--navy-700);
}
.sym {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow-wrap: anywhere;
}
.nowrap {
  white-space: nowrap;
}
</style>
