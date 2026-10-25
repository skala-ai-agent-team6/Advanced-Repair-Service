<script setup lang="ts">
/* 부품 재고 카드 — 창고별 위치·수량, 생산 공장·연락처, 예상 입고일 */
import { computed } from 'vue'
import { Factory, Phone, Mail, Warehouse, CalendarClock, PackageX, PackageCheck } from 'lucide-vue-next'
import type { Part } from '@/types'
import { formatNumber } from '@/utils/format'

const props = defineProps<{ part: Part; highlightWarehouse?: string }>()
const total = computed(() => props.part.stocks.reduce((a, s) => a + s.quantity, 0))
const eta = computed(() => {
  const d = new Date(Date.now() + props.part.leadTimeDays * 86400000)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
})
</script>

<template>
  <article class="card part">
    <header class="ph">
      <div>
        <h3>{{ part.name }}</h3>
        <span class="mono pn">{{ part.partNo }}</span>
      </div>
      <span class="badge" :class="total > 0 ? 'tone-success' : 'tone-danger'">
        <component :is="total > 0 ? PackageCheck : PackageX" :size="16" />
        {{ total > 0 ? `재고 ${total}개` : '재고 없음' }}
      </span>
    </header>
    <div class="pb">
      <div class="compat">
        <span class="faint">호환 제품</span>
        <span v-for="m in part.compatibleModels" :key="m" class="badge tone-neutral">{{ m }}</span>
      </div>
      <table class="table stock">
        <thead>
          <tr><th scope="col"><Warehouse :size="14" /> 창고</th><th scope="col">위치</th><th scope="col" style="text-align: right">수량</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in part.stocks" :key="s.warehouse" :class="{ hl: s.warehouse === highlightWarehouse }">
            <td><strong>{{ s.warehouse }}</strong></td>
            <td>{{ s.location }}</td>
            <td style="text-align: right">
              <strong :class="s.quantity === 0 ? 'zero' : s.quantity < 3 ? 'low' : ''">{{ s.quantity }}개</strong>
              <span v-if="s.quantity > 0 && s.quantity < 3" class="faint"> (부족)</span>
            </td>
          </tr>
        </tbody>
      </table>
      <dl class="kv">
        <dt><Factory :size="15" /> 생산 공장</dt>
        <dd>{{ part.factory }}</dd>
        <!-- 실서버에는 공장 담당자·이메일·단가 정보가 없어 값이 있을 때만 표시 -->
        <template v-if="part.factoryContact.manager">
          <dt>공장 담당</dt>
          <dd>{{ part.factoryContact.manager }}</dd>
        </template>
        <template v-if="part.factoryContact.phone">
          <dt><Phone :size="15" /> 연락처</dt>
          <dd><a :href="`tel:${part.factoryContact.phone}`">{{ part.factoryContact.phone }}</a></dd>
        </template>
        <template v-if="part.factoryContact.email">
          <dt><Mail :size="15" /> 이메일</dt>
          <dd><a :href="`mailto:${part.factoryContact.email}`">{{ part.factoryContact.email }}</a></dd>
        </template>
        <template v-if="part.leadTimeDays">
          <dt><CalendarClock :size="15" /> 예상 입고일</dt>
          <dd>{{ part.leadTimeDays }}일 (약 {{ eta }})</dd>
        </template>
        <template v-if="part.unitPrice">
          <dt>단가</dt>
          <dd>{{ formatNumber(part.unitPrice) }}원</dd>
        </template>
      </dl>
      <slot />
    </div>
  </article>
</template>

<style scoped>
.part {
  display: flex;
  flex-direction: column;
}
.ph {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 20px 0;
}
h3 {
  font-size: var(--fs-lg);
}
.pn {
  color: var(--navy-700);
  font-weight: 700;
}
.pb {
  padding: 12px 20px 18px;
  display: grid;
  /* 표·긴 이메일 때문에 좁은 화면에서 카드 밖으로 넘치지 않게 */
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}
.pb :deep(dd) {
  overflow-wrap: anywhere;
}
@media (max-width: 480px) {
  .stock td,
  .stock :deep(th) {
    padding: 8px 10px;
  }
}
.compat {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.stock {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.stock th svg {
  vertical-align: -2px;
}
.stock td {
  padding: 10px 14px;
}
.hl td {
  background: var(--navy-50);
}
.zero {
  color: var(--danger);
}
.low {
  color: var(--warning);
}
dl.kv dt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
