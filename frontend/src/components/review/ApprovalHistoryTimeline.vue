<script setup lang="ts">
/* 승인 이력 타임라인 — AI 행위와 사람 행위를 아이콘·색·라벨로 구분 */
import { computed } from 'vue'
import { Sparkles, UserCheck, UserX, MessageSquare, RotateCw, Send, Save, Camera, Package, FilePlus, Building2 } from 'lucide-vue-next'
import { ROLE_LABEL } from '@/constants/status'
import type { ApprovalAction, ApprovalRecord } from '@/types'
import { formatDateTime } from '@/utils/format'

const props = withDefaults(defineProps<{ records: ApprovalRecord[]; newestFirst?: boolean }>(), { newestFirst: true })
const list = computed(() => (props.newestFirst ? [...props.records].reverse() : props.records))

const ACTION: Record<ApprovalAction, { label: string; icon: unknown; tone: string }> = {
  CREATED: { label: '접수', icon: FilePlus, tone: 'info' },
  AI_GENERATED: { label: 'AI 초안 생성', icon: Sparkles, tone: 'ai' },
  CONFIRMED: { label: '관리자 확인', icon: UserCheck, tone: 'success' },
  APPROVED: { label: '승인', icon: UserCheck, tone: 'success' },
  REJECTED: { label: '반려', icon: UserX, tone: 'danger' },
  CHANGE_REQUESTED: { label: '수정 요청', icon: MessageSquare, tone: 'warning' },
  REANALYSIS_REQUESTED: { label: '재분석 요청', icon: RotateCw, tone: 'ai' },
  HQ_REVIEW_REQUESTED: { label: '본사 검토 요청', icon: Building2, tone: 'warning' },
  SUBMITTED: { label: '제출', icon: Send, tone: 'info' },
  DRAFT_SAVED: { label: '초안 저장', icon: Save, tone: 'info' },
  PHOTO_ADDED: { label: '추가 사진', icon: Camera, tone: 'info' },
  ORDER_REQUESTED: { label: '발주 요청', icon: Package, tone: 'warning' },
  COMMENTED: { label: '의견', icon: MessageSquare, tone: 'neutral' },
}
const TARGET = { DIAGNOSIS: '진단', REPORT: '수리 리포트', ORDER: '발주', PHOTO: '사진', SYSTEM: '접수' }
</script>

<template>
  <ol class="hist">
    <li v-for="r in list" :key="r.id" :class="`t-${ACTION[r.action].tone}`">
      <span class="ic"><component :is="ACTION[r.action].icon" :size="18" aria-hidden="true" /></span>
      <div class="b">
        <div class="row">
          <span class="badge" :class="`tone-${ACTION[r.action].tone}`">{{ TARGET[r.target] }} · {{ ACTION[r.action].label }}</span>
          <strong>{{ r.actor }}</strong>
          <span class="faint">{{ r.actorRole === 'AI' ? 'AI Agent' : r.actorRole === 'CUSTOMER' ? '고객' : ROLE_LABEL[r.actorRole] }}</span>
        </div>
        <p v-if="r.comment" class="cm">{{ r.comment }}</p>
        <span class="faint">{{ formatDateTime(r.at) }}</span>
      </div>
    </li>
    <li v-if="!list.length" class="faint">이력이 없습니다.</li>
  </ol>
</template>

<style scoped>
.hist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.hist > li {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}
.hist > li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 16px;
  top: 34px;
  bottom: 0;
  width: 2px;
  background: var(--border);
}
.ic {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--neutral-bg);
  color: var(--neutral);
}
.t-ai .ic { background: var(--ai-bg); color: var(--ai); border: 1px dashed var(--ai-border); }
.t-success .ic { background: var(--success-bg); color: var(--success); }
.t-danger .ic { background: var(--danger-bg); color: var(--danger); }
.t-warning .ic { background: var(--warning-bg); color: var(--warning); }
.t-info .ic { background: var(--info-bg); color: var(--info); }
.b {
  display: grid;
  gap: 4px;
  padding-top: 4px;
}
.cm {
  color: var(--text-2);
  white-space: pre-wrap;
}
</style>
