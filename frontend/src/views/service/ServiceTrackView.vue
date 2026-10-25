<script setup lang="ts">
/* =========================================================================
 * 고객 접수 내역 조회 (/service/track, /service/track/:token) — 로그인 없음, 휴대폰 우선
 *  접수번호 + 휴대폰 번호 뒷자리 4개, 또는 접수 완료 때 받은 조회 링크(토큰)로 조회
 *  표시: 접수 상태 · 방문 예정일 · 담당 기사 · 기사가 확정한 고장 원인 · 무상/유상 · 최종 수리 결과
 *  표시하지 않음: 미확정 AI 진단 · AI 판단 점수 · 재고 · 생산 공장 · MCP 실행 결과 · 내부 코멘트 (응답에 없음)
 * ========================================================================= */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Loader2, Check, CalendarDays, Wallet, Stethoscope, RotateCcw, Info, CircleAlert, UserRound, Wrench } from 'lucide-vue-next'
import StateView from '@/components/common/StateView.vue'
import { getCustomerReport, getCustomerReportByToken, CUSTOMER_NOT_FOUND, toErrorMessage, USE_MOCK } from '@/api'
import { ApiError } from '@/api/http'
import { FEATURES } from '@/api/features'
import type { CustomerReport, CustomerStage } from '@/types'

const route = useRoute()
const router = useRouter()
const available = USE_MOCK || FEATURES.customerReport
const form = reactive({ receiptNo: '', last4: '' })
const touched = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const report = ref<CustomerReport | null>(null)

const token = computed(() => (typeof route.params.token === 'string' ? route.params.token : ''))

async function run(fn: () => Promise<CustomerReport>) {
  loading.value = true
  error.value = null
  try {
    report.value = await fn()
    form.last4 = ''
    touched.value = false
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e) {
    report.value = null
    error.value = e instanceof ApiError && e.status === 404 ? CUSTOMER_NOT_FOUND : toErrorMessage(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // 접수 완료 화면·홈에서 넘어오면 값을 미리 채움 (주소창에 남기지 않도록 history state 로 전달)
  const st = window.history.state as { receiptNo?: unknown; last4?: unknown; auto?: unknown } | null
  if (typeof st?.receiptNo === 'string') form.receiptNo = st.receiptNo
  // 홈의 "이미 접수하셨나요?"에서 두 값을 모두 넘기면 바로 조회
  if (typeof st?.last4 === 'string' && /^\d{4}$/.test(st.last4)) {
    form.last4 = st.last4
    if (st.auto === true && !token.value) search()
  }
})
// 조회 링크로 들어오면 바로 조회
watch(token, (t) => t && available && void run(() => getCustomerReportByToken(t)), { immediate: true })

const errs = computed(() => ({
  receiptNo: !form.receiptNo.trim() ? '접수번호를 입력해 주세요.' : null,
  last4: !/^\d{4}$/.test(form.last4) ? '휴대폰 번호 뒷자리 4자리를 숫자로 입력해 주세요.' : null,
}))

function search() {
  touched.value = true
  error.value = null
  if (errs.value.receiptNo || errs.value.last4) return
  void run(() => getCustomerReport(form.receiptNo, form.last4))
}
function reset() {
  report.value = null
  error.value = null
  if (token.value) void router.replace('/service/track')
}

/* ---------- 결과 표시 ---------- */
const STEPS: { key: CustomerStage; label: string; desc: string }[] = [
  { key: 'RECEIVED', label: '접수 완료', desc: '수리 접수가 등록되었어요.' },
  { key: 'PHOTO_CHECK', label: '사진 확인', desc: '보내 주신 사진으로 고장 부위를 확인하고 있어요.' },
  { key: 'DIAGNOSED', label: '진단 완료', desc: '기사님이 고장 원인을 확인했어요.' },
  { key: 'VISIT_SCHEDULED', label: '방문 예정', desc: '방문 일정이 확정되었어요.' },
  { key: 'COMPLETED', label: '수리 완료', desc: '수리를 마쳤어요.' },
]
const stepIdx = computed(() => (report.value ? STEPS.findIndex((s) => s.key === report.value!.stage) : -1))

const WEEK = '일월화수목금토'
function niceDate(d?: string): string {
  if (!d) return ''
  const t = new Date(d.length === 10 ? `${d}T00:00:00` : d)
  return `${t.getMonth() + 1}월 ${t.getDate()}일 (${WEEK[t.getDay()]})`
}
</script>

<template>
  <div class="track">
    <h1>접수 내역 조회</h1>

    <StateView v-if="!available" state="empty" title="접수 내역 조회를 준비하고 있어요" message="진행 상황이 궁금하시면 고객센터로 문의해 주세요." class="card" />

    <!-- 조회 링크로 조회 중 -->
    <div v-else-if="token && loading && !report" class="card pad loading" role="status"><Loader2 :size="20" class="spin" /> 접수 내역을 불러오고 있어요…</div>

    <!-- ===== 조회 ===== -->
    <form v-else-if="!report" class="card form" novalidate @submit.prevent="search">
      <p class="muted">접수할 때 받은 <b>접수번호</b>와 <b>휴대폰 번호 뒷자리 4자리</b>를 입력해 주세요.</p>

      <div v-if="error" class="callout tone-danger" role="alert"><CircleAlert :size="20" /> {{ error }}</div>

      <div class="field">
        <label for="t-no" class="req">접수번호</label>
        <input id="t-no" v-model="form.receiptNo" class="input mono" :class="{ invalid: touched && errs.receiptNo }" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="예) SR-2026-10707" :aria-invalid="touched && !!errs.receiptNo" />
        <p v-if="touched && errs.receiptNo" class="error-text">{{ errs.receiptNo }}</p>
      </div>
      <div class="field">
        <label for="t-phone" class="req">휴대폰 번호 뒷자리</label>
        <input
          id="t-phone"
          v-model="form.last4"
          class="input mono last4"
          :class="{ invalid: touched && errs.last4 }"
          inputmode="numeric"
          autocomplete="off"
          maxlength="4"
          placeholder="1234"
          :aria-invalid="touched && !!errs.last4"
          @input="form.last4 = form.last4.replace(/\D/g, '')"
        />
        <p v-if="touched && errs.last4" class="error-text">{{ errs.last4 }}</p>
      </div>
      <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="loading">
        <Loader2 v-if="loading" :size="20" class="spin" /><Search v-else :size="20" /> {{ loading ? '조회 중…' : '조회하기' }}
      </button>
      <p class="faint center">아직 접수하지 않으셨나요? <RouterLink to="/service/request">고장 접수하기</RouterLink></p>
    </form>

    <!-- ===== 결과 ===== -->
    <template v-else>
      <section class="card head">
        <p class="faint">접수번호 <span class="mono">{{ report.receiptNo }}</span></p>
        <h2>{{ report.productName }}</h2>
        <p class="faint">{{ niceDate(report.receivedAt) }} 접수</p>
      </section>

      <p v-if="report.notice" class="callout" :class="report.cancelled ? 'tone-neutral' : 'tone-info'"><Info :size="20" /> {{ report.notice }}</p>

      <!-- 접수 상태 -->
      <section v-if="!report.cancelled" class="card pad" aria-labelledby="h-steps">
        <h3 id="h-steps" class="sec">접수 상태</h3>
        <ol class="steps">
          <li v-for="(s, i) in STEPS" :key="s.key" :class="{ done: i < stepIdx, now: i === stepIdx }" :aria-current="i === stepIdx ? 'step' : undefined">
            <span class="dot" aria-hidden="true"><Check v-if="i < stepIdx" :size="16" /><template v-else>{{ i + 1 }}</template></span>
            <span class="txt">
              <strong>{{ s.label }}<span v-if="i === stepIdx" class="badge tone-info now-badge">{{ i === STEPS.length - 1 ? '완료' : '진행 중' }}</span></strong>
              <span v-if="i === stepIdx" class="faint">{{ s.desc }}</span>
            </span>
          </li>
        </ol>
      </section>

      <!-- 방문 · 담당 기사 · 고장 원인 · 수리비 · 최종 결과 (기사가 확정한 내용만) -->
      <section v-if="!report.cancelled" class="card pad info" aria-label="수리 안내">
        <div class="item">
          <CalendarDays :size="22" class="ic" aria-hidden="true" />
          <div>
            <h3 class="sec">기사 방문 예정일</h3>
            <p v-if="report.visit.confirmedDate"><b>{{ niceDate(report.visit.confirmedDate) }}</b> 방문 확정</p>
            <template v-else-if="report.visit.preferredDate">
              <p>희망일 {{ niceDate(report.visit.preferredDate) }}</p>
              <p class="faint">일정이 확정되면 연락드려요.</p>
            </template>
            <p v-else class="muted">일정이 정해지면 연락드려요.</p>
          </div>
        </div>
        <div class="item">
          <UserRound :size="22" class="ic" aria-hidden="true" />
          <div>
            <h3 class="sec">담당 기사</h3>
            <p v-if="report.technicianName">{{ report.technicianName }} 기사님</p>
            <p v-else class="muted">담당 기사님이 정해지면 알려 드려요.</p>
          </div>
        </div>
        <div class="item">
          <Stethoscope :size="22" class="ic" aria-hidden="true" />
          <div>
            <h3 class="sec">고장 원인</h3>
            <p v-if="report.cause">{{ report.cause }}</p>
            <p v-else class="muted">기사님이 확인하면 이곳에 알려 드려요.</p>
          </div>
        </div>
        <div class="item">
          <Wallet :size="22" class="ic" aria-hidden="true" />
          <div>
            <h3 class="sec">수리비</h3>
            <p v-if="report.warranty === 'FREE'"><b class="free">무상 수리</b> 보증 기간 안이라 수리비가 들지 않아요.</p>
            <p v-else-if="report.warranty === 'PAID'"><b>유상 수리</b> 수리비는 방문 시 기사님이 안내해 드려요.</p>
            <p v-else class="muted">기사님 확인 후 안내해 드려요.</p>
          </div>
        </div>
        <div class="item">
          <Wrench :size="22" class="ic" aria-hidden="true" />
          <div>
            <h3 class="sec">수리 결과</h3>
            <p v-if="report.result">{{ report.result }}</p>
            <p v-else class="muted">수리를 마치면 결과를 알려 드려요.</p>
          </div>
        </div>
      </section>

      <button type="button" class="btn btn-lg btn-block" @click="reset"><RotateCcw :size="20" /> 다른 접수 조회하기</button>
    </template>

    <p class="foot faint">조회한 정보는 저장되지 않아요. 문의는 고객센터로 연락해 주세요.</p>
  </div>
</template>

<style scoped>
.track {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}
h1 {
  font-size: var(--fs-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
  text-align: center;
  margin: 6px 0 4px;
}
.form {
  display: grid;
  gap: 16px;
  padding: 22px 20px;
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-2);
}
.last4 {
  letter-spacing: 0.3em;
  font-size: var(--fs-lg);
}
.center {
  text-align: center;
}
.head {
  padding: 18px 20px;
  display: grid;
  gap: 2px;
}
.head h2 {
  font-size: var(--fs-xl);
  font-weight: 600;
}
.pad {
  padding: 18px 20px;
}
.sec {
  font-size: var(--fs-md);
  font-weight: 700;
  margin: 0 0 6px;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.steps li {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 6px 0 14px;
  color: var(--text-3);
}
/* 세로 연결선 */
.steps li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 38px;
  bottom: -2px;
  width: 2px;
  background: var(--border);
}
.steps li.done:not(:last-child)::before {
  background: var(--success-border);
}
.dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--neutral-bg);
  font-weight: 700;
  font-size: var(--fs-sm);
}
.done .dot {
  background: var(--success);
  color: #fff;
}
.now .dot {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 0 4px var(--blue-100);
}
.txt {
  display: grid;
  gap: 2px;
  padding-top: 4px;
}
.done .txt,
.now .txt {
  color: var(--text);
}
.now-badge {
  margin-left: 8px;
  font-size: var(--fs-xs);
}
.info {
  display: grid;
  gap: 18px;
}
.item {
  display: flex;
  gap: 12px;
}
.item .ic {
  flex: none;
  margin-top: 1px;
  color: var(--primary);
}
.free {
  color: var(--success);
  margin-right: 4px;
}
.item b {
  margin-right: 4px;
}
.foot {
  text-align: center;
  font-size: var(--fs-xs);
  margin-top: 8px;
}
</style>
