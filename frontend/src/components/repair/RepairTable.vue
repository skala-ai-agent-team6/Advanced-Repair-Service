<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ChevronRight, Camera } from 'lucide-vue-next'
import RepairStatusBadge from '@/components/common/RepairStatusBadge.vue'
import type { Repair, Role } from '@/types'
import { formatDateTime, repairId } from '@/utils/format'
import { nextAction, repairLink } from '@/utils/repairFlow'

const props = defineProps<{ items: Repair[]; role: Role | null; showTech?: boolean }>()
const router = useRouter()
const open = (r: Repair) => router.push(repairLink(r, props.role))
</script>

<template>
  <div class="table-wrap">
    <table class="table">
      <caption class="sr-only">수리 목록</caption>
      <thead>
        <tr>
          <th scope="col">수리 ID</th>
          <th scope="col">시리얼 번호</th>
          <th scope="col">제품 모델</th>
          <th scope="col">상태</th>
          <th scope="col">다음 할 일</th>
          <th scope="col">접수일</th>
          <th v-if="showTech !== false" scope="col">담당 기사</th>
          <th scope="col"><span class="sr-only">열기</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in items" :key="r.id" class="clickable" tabindex="0" @click="open(r)" @keydown.enter="open(r)">
          <td>
            <span class="mono rno">{{ repairId(r.id) }}</span>
          </td>
          <td class="mono">{{ r.product.serialNumber }}</td>
          <td>
            <strong>{{ r.product.model }}</strong>
            <div class="faint sym" :title="r.symptom">{{ r.symptom }}</div>
          </td>
          <td>
            <RepairStatusBadge :status="r.status" :failed="!!r.analysisError" />
            <div v-if="['ANALYZING', 'QUEUED'].includes(r.status) && !r.analysisError" class="mini" :aria-label="`진행률 ${r.progress}%`">
              <span :style="{ width: `${r.progress}%` }" />
            </div>
            <div v-if="r.photoRequestCount" class="faint"><Camera :size="13" /> 추가 사진 {{ r.photoRequestCount }}/3</div>
          </td>
          <td class="next">{{ nextAction(r, role) }}</td>
          <td class="nowrap">{{ formatDateTime(r.receivedAt) }}</td>
          <td v-if="showTech !== false" class="nowrap">
            {{ r.technician }} <span v-if="r.source === 'CUSTOMER'" class="badge tone-info">고객 접수</span>
            <div class="faint">{{ r.branch }}</div>
          </td>
          <td><ChevronRight :size="20" class="chev" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rno {
  font-weight: 700;
  color: var(--navy-700);
  white-space: nowrap;
}
.sym {
  /* 증상은 핵심 정보: 한 줄로 자르지 않고 두 줄까지 (넘치면 title 로 전체) */
  max-width: 320px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow-wrap: anywhere;
}
.next {
  font-weight: 600;
  color: var(--navy-800);
}
.nowrap {
  white-space: nowrap;
}
.mini {
  margin-top: 6px;
  height: 5px;
  width: 120px;
  background: var(--ai-bg);
  border-radius: 99px;
  overflow: hidden;
}
.mini span {
  display: block;
  height: 100%;
  background: var(--ai);
  transition: width 0.5s;
}
.chev {
  color: var(--text-3);
}
tr:focus-visible {
  outline: 3px solid var(--navy-600);
  outline-offset: -3px;
}
</style>
