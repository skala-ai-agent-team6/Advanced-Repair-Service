<script setup lang="ts">
/* =========================================================================
 * AI 진단 리포트 (서비스 핵심 화면) — '노트(공책)' 형태
 *  종이 한 장씩 넘겨 보는 구조. 페이지는 URL ?page=1|2 로 유지, ←/→ 키로 넘김
 *  1쪽 결론 요약: 결론 · 보증 판정 · AI 원인 후보 | 유사 사례(MCP) / 사진별 분석 카드 / 상세 보기(접이식) / 처리 버튼(하단 고정)
 *  2쪽 부품 발주(출장 준비 · 부품): 출장 전 챙길 부품·재고 예약 + 교체 부품 리스트 + 주문하기 (진단 확인 전에는 잠금)
 *  처리: 진단 내용 확인 / 본사 검토 요청 / 진단 반려
 * ========================================================================= */
import { computed, onBeforeUnmount, onMounted, reactive, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CircleCheck, RotateCw, Building2, CircleX, FileCode2, History, ClipboardList, BookOpen,
  ArrowRight, ChevronLeft, ChevronRight, Lock, Check, FileSearch,
} from 'lucide-vue-next'
import RepairFlowNav from '@/components/repair/RepairFlowNav.vue'
import RepairSummaryCard from '@/components/repair/RepairSummaryCard.vue'
import SameSerialHistory from '@/components/repair/SameSerialHistory.vue'
import PhotoAnalysisCard from '@/components/diagnosis/PhotoAnalysisCard.vue'
import PartsOrderPage from '@/components/parts/PartsOrderPage.vue'
import WarrantyCard from '@/components/diagnosis/WarrantyCard.vue'
import ApprovalHistoryTimeline from '@/components/review/ApprovalHistoryTimeline.vue'
import AiBadge from '@/components/common/AiBadge.vue'
import CollapsibleSection from '@/components/common/CollapsibleSection.vue'
import DataSourceList from '@/components/common/DataSourceList.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { useRepairPage } from '@/composables/useRepairPage'
import { provideCollapsibleGroup } from '@/composables/useCollapsibleGroup'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import { formatDate, reportTitle } from '@/utils/format'
import type { AgentResult, PhotoKind } from '@/types'

const { store, repair, diagnosis, versions, loading, diagLoading, error, submitting, reload } = useRepairPage({ diagnosis: true, live: true })
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()
provideCollapsibleGroup('diagnosis')

// 브라우저 탭에서도 시리얼이 아닌 수리 ID 로 구분되도록
watchEffect(() => {
  if (repair.value) document.title = `${reportTitle(repair.value)} · RobotCare AI`
})

/* ---------- 노트 페이지 (?page=1|2) ---------- */
const PAGES = [
  { no: 1, label: '결론 요약' },
  { no: 2, label: FEATURES.stockReservation ? '출장 준비 · 부품' : '부품 발주' },
] as const
const page = computed(() => (route.query.page === '2' ? 2 : 1))
function go(p: number) {
  if (p < 1 || p > PAGES.length || p === page.value) return
  void router.replace({ query: { ...route.query, page: String(p) } })
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  if (e.altKey || e.ctrlKey || e.metaKey || dlg.open || document.querySelector('[aria-modal="true"]')) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
  go(page.value + (e.key === 'ArrowRight' ? 1 : -1))
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** 2쪽은 진단을 확인(또는 반려)한 뒤에 연다 */
const partsUnlocked = computed(() => ['APPROVED', 'REJECTED'].includes(diagnosis.value?.technicianDecision.state ?? ''))

/* ---------- 처리 권한 ---------- */
const isTech = computed(() => auth.role === 'TECHNICIAN')
const canDecide = computed(() => FEATURES.diagnosisDecision && isTech.value && repair.value?.status === 'DIAGNOSIS_COMPLETED')
const disabledReason = computed(() => {
  if (!FEATURES.diagnosisDecision) return '진단 확인·반려 처리는 아직 백엔드에서 지원하지 않습니다. (조회 전용)'
  if (!isTech.value) return '진단 확인은 담당 서비스센터 기사만 할 수 있습니다. (조회 전용)'
  if (repair.value?.status !== 'DIAGNOSIS_COMPLETED') return '이미 처리되었거나 진단 확인 단계가 아닙니다.'
  return undefined
})
const pending = computed(() => diagnosis.value?.technicianDecision.state === 'PENDING')

/* ---------- 처리 버튼 · 사유 모달 ---------- */
// [통합] '수정 의견 작성'(상태 변화 없음)·'추가 분석 요청'(재진단 API 없음) 버튼 삭제.
//        남은 3개는 모두 바로 보이게 두고 '더 보기' 메뉴는 없앰
type ActionKey = 'approve' | 'hq' | 'reject'
const ACTIONS: Record<ActionKey, { label: string; icon: unknown; btn: string; needsReason: boolean; reasonLabel: string; hint: string; placeholder: string }> = {
  approve: { label: '진단 내용 확인', icon: CircleCheck, btn: 'btn-success', needsReason: false, reasonLabel: '확인 메모 (선택)', hint: '이 진단을 기준으로 점검·수리를 진행합니다.', placeholder: '예) 하단 연결부 들뜸 육안 확인' },
  hq: { label: '본사 검토 요청', icon: Building2, btn: '', needsReason: true, reasonLabel: '본사 검토 요청 사유', hint: '본사 품질 담당자가 직접 진단합니다.', placeholder: '예) 사진으로 판단이 어려워 본사 확인이 필요합니다.' },
  reject: { label: '진단 반려', icon: CircleX, btn: 'btn-danger', needsReason: true, reasonLabel: '반려 사유', hint: 'AI 진단을 쓰지 않고 직접 점검합니다.', placeholder: '예) 실제 점검 결과 모터는 정상, 배터리 커넥터 산화 확인' },
}
const PRIMARY: ActionKey[] = ['approve', 'hq', 'reject']

const dlg = reactive({ open: false, key: 'approve' as ActionKey, text: '', error: '' })
function openAction(key: ActionKey) {
  Object.assign(dlg, { open: true, key, text: '', error: '' })
}
async function confirmAction() {
  const a = ACTIONS[dlg.key]
  const comment = dlg.text.trim()
  if (a.needsReason && comment.length < 2) {
    dlg.error = '사유를 입력해 주세요.'
    return
  }
  try {
    switch (dlg.key) {
      case 'approve':
        await store.decide({ target: 'DIAGNOSIS', action: 'APPROVE', comment, diagnosisVersion: diagnosis.value?.version })
        toast.success('진단 내용을 확인했습니다. 2쪽에서 필요 부품을 확인해 주세요.')
        break
      case 'hq':
        await store.decide({ target: 'DIAGNOSIS', action: 'REQUEST_HQ_REVIEW', comment })
        toast.info('본사 품질 담당자에게 검토를 요청했습니다.')
        break
      case 'reject':
        await store.decide({ target: 'DIAGNOSIS', action: 'REJECT', comment })
        toast.warning('AI 진단을 반려했습니다. 직접 점검 후 수리 리포트를 작성해 주세요.')
        break
    }
    dlg.open = false
  } catch (e) {
    dlg.error = toErrorMessage(e)
  }
}

/* ---------- 1쪽 데이터 ---------- */
const candidates = computed(() => diagnosis.value?.candidates.slice(0, 3) ?? [])
const cases = computed(() => diagnosis.value?.similarCases.slice(0, 3) ?? [])
const moreCases = computed(() => Math.max(0, (diagnosis.value?.similarCaseCount || 0) - cases.value.length))
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

/** 사진별 분석 카드: PCB → 기계 → 추가 사진 순. 사진이 없는 부위는 카드가 생기지 않는다 */
const PHOTO_KINDS: { kind: PhotoKind; label: string }[] = [
  { kind: 'PCB', label: 'PCB' },
  { kind: 'MOTOR', label: '기계' },
  { kind: 'ADDITIONAL', label: '추가 사진' },
]
const agents = computed(() => diagnosis.value?.agents ?? [])
/** 이 사진에 이상 영역을 표시한 부위 판단 → 없으면 사진 종류로 (추가 사진은 기계 분석에 쓰임) */
function agentFor(imageId: string, kind: PhotoKind): AgentResult | undefined {
  return agents.value.find((a) => a.annotations.some((an) => an.imageId === imageId)) ?? agents.value.find((a) => a.agent === (kind === 'PCB' ? 'PCB' : 'MOTOR'))
}
const photoCards = computed(() =>
  PHOTO_KINDS.flatMap(({ kind }) =>
    (repair.value?.images ?? [])
      .filter((i) => i.kind === kind)
      .map((image, i) => ({
        image,
        index: i + 1,
        agent: agentFor(image.id, kind),
        anns: agents.value.flatMap((a) => a.annotations.filter((an) => an.imageId === image.id)),
      })),
  ),
)
const photoCounts = computed(() =>
  PHOTO_KINDS.map((k) => ({ ...k, n: photoCards.value.filter((c) => c.image.kind === k.kind).length }))
    .filter((k) => k.n)
    .map((k) => `${k.label} ×${k.n}`)
    .join(' · '),
)

const detailSummary = computed(() => {
  const d = diagnosis.value
  if (!d) return ''
  return [
    d.inspectionSteps.length && `점검 ${d.inspectionSteps.length}단계`,
    d.errorCodes.length && `에러 코드 ${d.errorCodes.length}`,
    d.sources.length && `출처 ${d.sources.length}`,
    repair.value?.history.length && `이력 ${repair.value.history.length}`,
  ]
    .filter(Boolean)
    .join(' · ')
})
</script>

<template>
  <div class="page">
    <div v-if="loading && !repair" class="stack"><SkeletonBlock :lines="2" :height="60" /><SkeletonBlock :lines="8" :height="36" /></div>
    <StateView v-else-if="error && !repair" state="error" :message="error" @retry="reload" />

    <template v-else-if="repair">
      <RepairFlowNav :repair="repair" />
      <div class="page-head">
        <div>
          <h1>{{ reportTitle(repair) }}</h1>
          <p class="sub">시리얼 <span class="mono">{{ repair.product.serialNumber }}</span> · 접수번호 <span class="mono">{{ repair.receiptNo }}</span></p>
        </div>
      </div>
      <RepairSummaryCard :repair="repair" compact />
      <SameSerialHistory :serial="repair.product.serialNumber" :exclude-id="repair.id" />

      <div v-if="diagLoading && !diagnosis" class="card card-pad"><SkeletonBlock :lines="6" :height="28" /></div>

      <!-- 진단 없음 -->
      <section v-else-if="!diagnosis" class="card">
        <StateView
          :state="repair.status === 'MANUAL_REVIEW' ? 'empty' : 'loading'"
          :title="repair.status === 'MANUAL_REVIEW' ? 'AI 진단 없이 본사 수동 검토 중입니다' : '아직 AI 진단이 완료되지 않았습니다'"
          :message="repair.status === 'MANUAL_REVIEW' ? '품질 담당자의 수동 진단 회신을 기다리고 있습니다.' : '분석이 끝나면 이 화면에 AI 초안이 표시됩니다.'"
        >
          <RouterLink :to="`/repairs/${repair.id}/progress`" class="btn">진행 상황 보기</RouterLink>
        </StateView>
      </section>

      <template v-else>
        <!-- 재분석 중 안내 -->
        <div v-if="['QUEUED', 'ANALYZING'].includes(repair.status)" class="callout tone-ai">
          <RotateCw :size="20" class="spin" />
          <div class="grow"><strong>재분석이 진행 중입니다.</strong> 아래는 이전 버전(v{{ diagnosis.version }}) 결과입니다.</div>
          <RouterLink :to="`/repairs/${repair.id}/progress`" class="btn btn-sm">진행 보기</RouterLink>
        </div>

        <!-- ===== 진단 노트 ===== -->
        <section class="notebook" aria-label="진단 리포트 노트">
          <div class="nb-bar">
            <button type="button" class="btn btn-ghost nav" :disabled="page === 1" aria-label="이전 페이지" @click="go(page - 1)"><ChevronLeft :size="22" /></button>
            <div class="tabs" role="tablist" aria-label="노트 페이지">
              <button
                v-for="p in PAGES"
                :id="`nb-tab-${p.no}`"
                :key="p.no"
                type="button"
                role="tab"
                class="tab"
                :class="{ on: page === p.no }"
                :aria-selected="page === p.no"
                aria-controls="nb-page"
                @click="go(p.no)"
              >
                <span class="no">{{ p.no }}</span> {{ p.label }}
                <Lock v-if="p.no === 2 && !partsUnlocked" :size="15" aria-label="잠김" />
              </button>
            </div>
            <button type="button" class="btn btn-ghost nav" :disabled="page === PAGES.length" aria-label="다음 페이지" @click="go(page + 1)"><ChevronRight :size="22" /></button>
            <span class="spacer" />
            <AiBadge />
            <AiBadge v-if="diagnosis.technicianDecision.state === 'APPROVED'" kind="human" label="진단 확인 완료" />
            <span class="faint ver">v{{ diagnosis.version }}<template v-if="versions.length > 1"> / {{ versions.length }}</template></span>
          </div>

          <article id="nb-page" class="paper" role="tabpanel" :aria-labelledby="`nb-tab-${page}`">
            <!-- ---------- 1쪽: 결론 요약 ---------- -->
            <template v-if="page === 1">
              <div class="top">
                <div class="col">
                  <section class="conclusion" aria-labelledby="h-conc">
                    <h2 id="h-conc" class="h">결론 요약</h2>
                    <div class="conc-body">
                      <div class="conc-text">
                        <p class="cause">{{ diagnosis.topCause }}</p>
                        <p v-if="diagnosis.repairMethod[0]" class="todo"><ArrowRight :size="18" /> {{ diagnosis.repairMethod[0] }}</p>
                      </div>
                      <p class="big-score" :aria-label="`판단 점수 ${diagnosis.confidence}점`">
                        <span class="num-xl">{{ diagnosis.confidence }}</span><small>점</small>
                        <span class="faint">판단 점수</span>
                      </p>
                    </div>
                  </section>

                  <!-- 보증 판정 (AI 제안 → 기사 확정). 실서버 API 없으면 숨김 -->
                  <WarrantyCard v-if="FEATURES.warranty" :repair-id="repair.id" :can-decide="isTech" />

                  <section v-if="candidates.length" aria-labelledby="h-cand">
                    <h2 id="h-cand" class="h">AI 원인 후보</h2>
                    <ol class="cands">
                      <li v-for="c in candidates" :key="c.rank">
                        <span class="rank">{{ c.rank }}</span>
                        <div class="grow">
                          <div class="row between">
                            <strong>{{ c.cause }}</strong>
                            <span class="score">{{ c.confidence }}점</span>
                          </div>
                          <div class="meter" aria-hidden="true"><span :style="{ width: `${c.confidence}%` }" /></div>
                          <p v-if="c.evidence[0]" class="faint">{{ c.evidence[0] }}</p>
                        </div>
                      </li>
                    </ol>
                    <p class="faint note">판단 점수는 확률이 아니라 후보끼리 비교한 점수입니다.</p>
                  </section>
                </div>

                <section class="col cases-col" aria-labelledby="h-cases">
                  <h2 id="h-cases" class="h">유사 사례 <span class="badge tone-info">MCP</span></h2>
                  <ul v-if="cases.length" class="cases">
                    <li v-for="(c, i) in cases" :key="c.receiptNo">
                      <Check :size="18" class="ck" aria-hidden="true" />
                      <span class="circ" aria-hidden="true">{{ CIRCLED[i] }}</span>
                      <div class="grow">
                        <div class="row between">
                          <strong>{{ c.cause }}</strong>
                          <span class="badge tone-ai">유사도 {{ c.similarity }}%</span>
                        </div>
                        <p v-if="c.resolution" class="muted">→ {{ c.resolution }}</p>
                        <p class="faint">{{ c.receiptNo }} · {{ c.model }}<template v-if="c.closedAt"> · {{ formatDate(c.closedAt) }}</template></p>
                      </div>
                    </li>
                  </ul>
                  <p v-else class="faint">찾은 유사 사례가 없습니다.</p>
                  <p v-if="moreCases" class="faint">외 {{ moreCases }}건</p>
                </section>
              </div>

              <section v-if="photoCards.length" class="photos-sec" aria-labelledby="h-photos">
                <h2 id="h-photos" class="h">사진별 분석 <span class="faint cnt">{{ photoCounts }}</span></h2>
                <div class="photos">
                  <PhotoAnalysisCard
                    v-for="c in photoCards"
                    :key="c.image.id"
                    :image="c.image"
                    :index="c.index"
                    :agent="c.agent"
                    :annotations="c.anns"
                    :sources="diagnosis.sources"
                  />
                </div>
              </section>

              <!-- 확인 후 다음 단계 -->
              <div v-if="diagnosis.technicianDecision.state === 'APPROVED' && isTech && repair.status === 'TECHNICIAN_REVIEW'" class="callout tone-success next">
                <CircleCheck :size="24" />
                <div class="grow"><strong>다음 단계</strong> 필요 부품은 위의 2쪽 탭에서 확인하고, 수리를 마친 뒤 실제 결과를 입력해 주세요.</div>
                <RouterLink :to="`/repairs/${repair.id}/review`" class="btn btn-primary btn-lg">수리 리포트 작성 <ArrowRight :size="20" /></RouterLink>
              </div>

              <!-- 상세 보기 (기존 접이식 상세) -->
              <CollapsibleSection id="details" title="상세 보기" :summary="detailSummary" :icon="FileSearch">
                <div class="details">
                  <section v-if="diagnosis.inspectionSteps.length || diagnosis.repairMethod.length">
                    <h4 class="sub-h"><ClipboardList :size="18" /> 점검 순서 · 수리 방법</h4>
                    <div class="steps-grid">
                      <div v-if="diagnosis.inspectionSteps.length">
                        <h5 class="mini-h">권장 점검 순서</h5>
                        <ol class="steps"><li v-for="s in diagnosis.inspectionSteps" :key="s">{{ s }}</li></ol>
                      </div>
                      <div v-if="diagnosis.repairMethod.length">
                        <h5 class="mini-h">권장 수리 방법</h5>
                        <ol class="steps"><li v-for="s in diagnosis.repairMethod" :key="s">{{ s }}</li></ol>
                      </div>
                    </div>
                  </section>

                  <section v-if="diagnosis.errorCodes.length">
                    <h4 class="sub-h"><FileCode2 :size="18" /> 에러 코드</h4>
                    <div class="stack">
                      <div v-for="ec in diagnosis.errorCodes" :key="ec.code" class="ec">
                        <span class="badge tone-info mono code">{{ ec.code }}</span>
                        <div class="stack" style="gap: 6px">
                          <strong>{{ ec.meaning }}</strong>
                          <p>{{ ec.interpretation }}</p>
                          <div class="row"><span class="faint">관련 부품</span><span v-for="p in ec.relatedParts" :key="p" class="badge tone-neutral">{{ p }}</span></div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section v-if="diagnosis.sources.length">
                    <h4 class="sub-h"><BookOpen :size="18" /> 참고 매뉴얼 · 데이터 출처</h4>
                    <DataSourceList :sources="diagnosis.sources" />
                  </section>

                  <section v-if="repair.history.length || versions.length > 1">
                    <h4 class="sub-h"><History :size="18" /> 처리 이력</h4>
                    <div v-if="versions.length > 1" class="versions">
                      <h5 class="mini-h">이전 진단 버전 ({{ versions.length - 1 }})</h5>
                      <ul>
                        <li v-for="v in versions.slice(0, -1).reverse()" :key="v.id" class="row between">
                          <span><b>v{{ v.version }}</b> · {{ v.topCause }} (판단 점수 {{ v.confidence }}점)</span>
                          <span class="faint">{{ v.technicianDecision.state === 'REANALYSIS_REQUESTED' ? `재분석 요청: ${v.technicianDecision.comment}` : v.technicianDecision.state }}</span>
                        </li>
                      </ul>
                    </div>
                    <ApprovalHistoryTimeline :records="repair.history" />
                  </section>
                </div>
              </CollapsibleSection>

              <!-- 처리 버튼 (1쪽 하단 고정, 승인 대기 중일 때만) -->
              <div v-if="pending" class="actions" role="group" aria-label="진단 결과 처리">
                <template v-if="canDecide">
                  <button v-for="k in PRIMARY" :key="k" type="button" class="btn btn-lg" :class="ACTIONS[k].btn" :disabled="submitting" @click="openAction(k)">
                    <component :is="ACTIONS[k].icon" :size="20" /> {{ ACTIONS[k].label }}
                  </button>
                </template>
                <p v-else class="locked"><Lock :size="18" /> {{ disabledReason }}</p>
              </div>
            </template>

            <!-- ---------- 2쪽: 부품 발주 ---------- -->
            <template v-else>
              <div class="row between p2-head">
                <h2 class="h">{{ PAGES[1].label }}</h2>
                <RouterLink v-if="isTech && repair.status === 'TECHNICIAN_REVIEW'" :to="`/repairs/${repair.id}/review`" class="btn btn-primary">수리 리포트 작성 <ArrowRight :size="18" /></RouterLink>
              </div>
              <PartsOrderPage v-if="partsUnlocked" :repair="repair" :diagnosis="diagnosis" />
              <StateView v-else state="empty" title="진단 내용을 먼저 확인해 주세요" message="1쪽에서 AI 진단 내용을 확인하면 교체 부품의 재고 확인과 주문 요청을 할 수 있습니다.">
                <button type="button" class="btn btn-primary" @click="go(1)"><ChevronLeft :size="18" /> 1쪽 결론 요약으로</button>
              </StateView>
            </template>

            <footer class="page-no" aria-live="polite">{{ page }} / {{ PAGES.length }}</footer>
          </article>
        </section>
      </template>
    </template>

    <!-- 처리 확인 · 사유 입력 모달 -->
    <BaseModal :open="dlg.open" :title="ACTIONS[dlg.key].label" :width="560" @close="dlg.open = false">
      <div class="stack">
        <p class="muted">{{ ACTIONS[dlg.key].hint }}</p>
        <p v-if="diagnosis" class="dlg-sugg"><b>AI 제안</b> {{ diagnosis.topCause }} (판단 점수 {{ diagnosis.confidence }}점)<template v-if="diagnosis.repairMethod[0]"> → {{ diagnosis.repairMethod[0] }}</template></p>
        <div class="field">
          <label for="dlg-text" :class="{ req: ACTIONS[dlg.key].needsReason }">{{ ACTIONS[dlg.key].reasonLabel }}</label>
          <textarea id="dlg-text" v-model="dlg.text" class="textarea" :class="{ invalid: dlg.error }" :placeholder="ACTIONS[dlg.key].placeholder" maxlength="1000" :aria-invalid="!!dlg.error" @input="dlg.error = ''" />
          <p v-if="dlg.error" class="error-text" role="alert">{{ dlg.error }}</p>
        </div>
      </div>
      <template #footer>
        <button class="btn" type="button" :disabled="submitting" @click="dlg.open = false">취소</button>
        <button class="btn" :class="ACTIONS[dlg.key].btn || 'btn-primary'" type="button" :disabled="submitting" @click="confirmAction">
          <component :is="ACTIONS[dlg.key].icon" :size="18" /> {{ submitting ? '처리 중…' : ACTIONS[dlg.key].label }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.grow {
  flex: 1 1 0;
  min-width: 0;
}
.next {
  align-items: center;
  flex-wrap: wrap;
}
.next .grow {
  flex-basis: 280px;
}

/* ---------- 노트 ---------- */
.notebook {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}
.notebook {
  gap: 14px;
}
.nb-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}
.nav {
  align-self: center;
  min-width: 44px;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 6px 18px 6px 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-2);
  font-weight: 700;
  cursor: pointer;
}
.tab:hover:not(.on) {
  background: var(--blue-50);
}
.tab .no {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--border);
  font-size: var(--fs-xs);
}
.tab.on {
  background: var(--ink);
  color: #fff;
}
.tab.on .no {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.tab:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}
.ver {
  align-self: center;
}
.nb-bar > :deep(.badge) {
  align-self: center;
}
.paper {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  padding: 32px 36px 22px;
  background: #fff;
  color: var(--text);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
.page-no {
  justify-self: center;
  color: var(--text-3);
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0.1em;
}
.h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: var(--fs-lg);
}

/* 1쪽 위: 왼쪽(결론·후보) | 오른쪽(유사 사례) */
.top {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 28px;
}
.col {
  display: grid;
  gap: 22px;
  align-content: start;
}
.conclusion {
  padding: 20px 22px;
  background: var(--blue-50);
  border-radius: var(--radius-lg);
}
.conc-body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 20px;
}
.conc-text {
  flex: 1 1 240px;
  min-width: 0;
}
.cause {
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--ink);
}
.big-score {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 2px;
  margin: 0;
}
.big-score small {
  color: var(--text-2);
  font-weight: 600;
}
.big-score .faint {
  grid-column: 1 / -1;
  font-size: var(--fs-xs);
}
.todo {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-top: 8px;
  font-weight: 600;
}
.todo svg {
  flex: none;
  margin-top: 3px;
  color: var(--navy-700);
}
.cands {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.cands li {
  display: flex;
  gap: 12px;
}
.rank {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--ai-bg);
  color: var(--ai);
  font-weight: 800;
}
.cands li:first-child .rank {
  background: var(--ai);
  color: #fff;
}
.score {
  font-weight: 800;
  color: var(--ai);
  white-space: nowrap;
}
.meter {
  height: 6px;
  margin: 6px 0 4px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--ai);
}
.note {
  margin-top: 8px;
  font-size: var(--fs-xs);
}
.cases-col {
  padding-left: 28px;
  border-left: 1px dashed var(--border-strong);
  gap: 0;
}
.cases {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cases li {
  display: flex;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.cases li:last-child {
  border-bottom: 0;
}
.ck {
  flex: none;
  margin-top: 3px;
  color: var(--success);
}
.circ {
  flex: none;
  font-weight: 800;
  color: var(--navy-700);
}

/* 1쪽 아래: 사진별 분석 */
.cnt {
  font-size: var(--fs-sm);
  font-weight: 600;
}
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

/* 상세 보기 */
.details {
  display: grid;
  gap: 22px;
}
.sub-h {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-md);
  font-weight: 700;
  margin: 0 0 10px;
  color: var(--navy-800);
}
.mini-h {
  font-size: var(--fs-sm);
  font-weight: 700;
  margin: 0 0 6px;
  color: var(--text-2);
}
.steps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}
.steps {
  margin: 0;
  padding-left: 28px;
  display: grid;
  gap: 8px;
}
.steps li::marker {
  font-weight: 800;
  color: var(--ai);
}
.ec {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
}
.code {
  font-size: var(--fs-lg);
  padding: 6px 12px;
}
.versions {
  margin-bottom: 16px;
}
.versions ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

/* 처리 버튼: 1쪽 하단 고정 */
.actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 -36px -22px;
  padding: 14px 36px;
  background: rgba(255, 255, 255, 0.96);
  border-top: 1px solid var(--border);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  box-shadow: 0 -4px 14px rgba(15, 23, 42, 0.05);
}
.actions + .page-no {
  margin-top: 4px;
}
.locked {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-weight: 600;
}
.p2-head {
  flex-wrap: wrap;
}
.p2-head .h {
  margin: 0;
}
.dlg-sugg {
  padding: 10px 14px;
  border: 1px dashed var(--ai-border);
  border-radius: var(--radius);
  background: var(--ai-bg);
}

/* 태블릿: 위쪽 두 칸은 위아래로, 사진 카드는 가로 스크롤 */
@media (max-width: 1024px) {
  .top {
    grid-template-columns: 1fr;
  }
  .cases-col {
    padding-left: 0;
    padding-top: 18px;
    border-left: 0;
    border-top: 1px dashed var(--border-strong);
  }
  .photos {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: 8px;
  }
  .photos > * {
    flex: 0 0 min(320px, 82%);
    scroll-snap-align: start;
  }
}
@media (max-width: 640px) {
  .paper {
    padding: 18px 16px 14px;
  }
  .actions {
    margin: 0 -16px -14px;
    padding: 12px 16px;
  }
  .actions .btn {
    flex: 1 1 100%;
    justify-content: center;
  }
  .tab {
    padding: 8px 12px;
  }
}
</style>
