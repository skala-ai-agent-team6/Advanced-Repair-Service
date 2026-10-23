<script setup lang="ts">
/* 사진 업로드: 드래그·선택·카메라 촬영 / 미리보기 / 삭제 / 재업로드 / 형식·용량 검증
 * qualityTarget: 올린 사진마다 품질 검사 (US-03)
 *   PENDING 검사 중 → PASSED 통과 / WARNING 확인 필요 / FAILED 불합격 / ERROR 검사 실패
 *   - 해상도·밝기·선명도·판정·검사 시각 표시
 *   - WARNING: [재촬영] 또는 [현재 사진 사용](확인자·확인 시각 기록), FAILED: [재촬영], ERROR: [재검사]
 *   - 사진을 바꾸면 새 사진을 다시 검사하고, 바꾸기 전 결과는 '검사 이력'에 남긴다
 *   FEATURES.photoQualityCheck 가 꺼져 있으면(실서버) 검사 없이 업로드만 한다. */
import { computed, reactive, ref, watch } from 'vue'
import { Camera, ImagePlus, RefreshCw, Trash2, CircleAlert, CircleCheck, Loader2, TriangleAlert, RotateCw, History } from 'lucide-vue-next'
import type { QualitySummary, UploadItem } from '@/types/upload'
import type { PhotoQualityRecord, PhotoQualityResult, PhotoQualityStatus } from '@/types'
import { checkPhotoQuality, qualityStatusOf, toErrorMessage, type PhotoQualityTarget } from '@/api'
import { FEATURES } from '@/api/features'
import { PHOTO_ISSUE_MESSAGE, PHOTO_QUALITY_META } from '@/constants/status'
import { useAuthStore } from '@/stores/auth'
import { compressImage, formatDateTime, uid } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    modelValue: UploadItem[]
    label: string
    description?: string
    required?: boolean
    max?: number
    invalid?: boolean
    exampleSrc?: string
    /** 지정하면 이 부위 기준으로 품질 검사 */
    qualityTarget?: PhotoQualityTarget
  }>(),
  { max: 1 },
)
const emit = defineEmits<{
  'update:modelValue': [UploadItem[]]
  /** 검사 중 · 문제 있는 사진 수 (부모의 경고·확인용) */
  quality: [summary: QualitySummary]
}>()

const MAX_MB = 15
const input = ref<HTMLInputElement | null>(null)
const replaceId = ref<string | null>(null)
const dragging = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

async function toItems(files: FileList | File[]): Promise<UploadItem[]> {
  const out: UploadItem[] = []
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) {
      error.value = `${f.name}: 이미지 파일(JPG, PNG, HEIC)만 올릴 수 있습니다.`
      continue
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      error.value = `${f.name}: ${MAX_MB}MB 이하 사진만 올릴 수 있습니다.`
      continue
    }
    out.push({ id: uid('up'), file: f, dataUrl: await compressImage(f), name: f.name, size: f.size })
  }
  return out
}

async function onFiles(files: FileList | null) {
  if (!files?.length) return
  error.value = null
  busy.value = true
  try {
    const items = await toItems(files)
    if (!items.length) return
    if (replaceId.value) {
      archive(replaceId.value)
      emit('update:modelValue', props.modelValue.map((x) => (x.id === replaceId.value ? items[0] : x)))
    } else {
      const merged = [...props.modelValue, ...items]
      if (merged.length > props.max) error.value = `최대 ${props.max}장까지 등록할 수 있습니다. 앞의 ${props.max}장만 저장했습니다.`
      emit('update:modelValue', merged.slice(0, props.max))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '사진을 읽지 못했습니다.'
  } finally {
    busy.value = false
    replaceId.value = null
    if (input.value) input.value.value = ''
  }
}

/* ---------- 품질 검사 (사진 id 별) ---------- */
interface QEntry {
  status: PhotoQualityStatus
  result?: PhotoQualityResult
  error?: string
  ackBy?: string
  ackAt?: string
}
const auth = useAuthStore()
const quality = reactive<Record<string, QEntry>>({})
/** 이 칸에서 바꾸거나 지운 사진의 검사 결과 (오래된 순) */
const history = ref<PhotoQualityRecord['history']>([])
const checking = computed(() => !!props.qualityTarget && FEATURES.photoQualityCheck)

function run(it: UploadItem) {
  if (!props.qualityTarget) return
  quality[it.id] = { status: 'PENDING' }
  checkPhotoQuality(it.file, props.qualityTarget)
    .then((q) => {
      // 검사 중에 사진이 바뀌었으면 버린다
      if (quality[it.id]) quality[it.id] = { status: qualityStatusOf(q), result: q }
    })
    .catch((e) => quality[it.id] && (quality[it.id] = { status: 'ERROR', error: toErrorMessage(e) }))
}
watch(
  () => props.modelValue,
  (items) => {
    if (!checking.value) return
    for (const it of items) if (!quality[it.id]) run(it)
  },
  { immediate: true },
)
/** 바꾸거나 지우는 사진의 검사 결과를 이력으로 옮긴다 */
function archive(id: string) {
  const it = props.modelValue.find((x) => x.id === id)
  const q = quality[id]
  if (it && q) history.value.push({ name: it.name, status: q.status, checkedAt: q.result?.checkedAt })
  delete quality[id]
}
function recheck(it: UploadItem) {
  run(it)
}
/** [현재 사진 사용] — WARNING 사진을 기사가 확인하고 그대로 쓴다 */
function acknowledge(id: string) {
  const q = quality[id]
  if (!q || q.status !== 'WARNING') return
  q.ackBy = auth.user?.name ?? '기사'
  q.ackAt = new Date().toISOString()
}
const qOf = (id: string) => quality[id]
const problemOf = (id: string) => {
  const q = quality[id]
  return q && (q.status === 'WARNING' || q.status === 'FAILED') ? q : null
}
const summary = computed<QualitySummary>(() => {
  const items = props.modelValue
  const st = (it: UploadItem) => quality[it.id]
  return {
    checking: items.filter((it) => checking.value && (!st(it) || st(it).status === 'PENDING')).length,
    problems: items.filter((it) => problemOf(it.id) && !(st(it).status === 'WARNING' && st(it).ackAt)).length,
    failed: items.filter((it) => st(it)?.status === 'FAILED').length,
    unacked: items.filter((it) => st(it)?.status === 'WARNING' && !st(it).ackAt).length,
    records: Object.fromEntries(
      items
        .filter((it) => st(it))
        .map((it) => {
          const q = st(it)
          const rec: PhotoQualityRecord = {
            status: q.status,
            issues: q.result?.issues ?? [],
            metrics: q.result?.metrics,
            checkedAt: q.result?.checkedAt,
            acknowledgedBy: q.ackBy,
            acknowledgedAt: q.ackAt,
            history: [...history.value],
          }
          return [it.id, rec]
        }),
    ),
  }
})
watch(summary, (v) => emit('quality', v), { immediate: true, deep: true })

function pick(replace?: string) {
  replaceId.value = replace ?? null
  input.value?.click()
}
function remove(id: string) {
  archive(id)
  emit('update:modelValue', props.modelValue.filter((x) => x.id !== id))
}
function onDrop(e: DragEvent) {
  dragging.value = false
  void onFiles(e.dataTransfer?.files ?? null)
}
</script>

<template>
  <div class="uploader" :class="{ invalid: invalid && !modelValue.length }">
    <div class="head">
      <span class="label" :class="{ req: required }">{{ label }}</span>
      <span v-if="modelValue.length" class="badge tone-success"><CircleCheck :size="14" /> 등록됨<template v-if="max > 1"> {{ modelValue.length }}장</template></span>
      <span v-else-if="required" class="badge tone-warning"><CircleAlert :size="14" /> 필수</span>
    </div>
    <p v-if="description" class="faint">{{ description }}</p>

    <input ref="input" type="file" accept="image/*" :multiple="max > 1 && !replaceId" class="sr-only" :aria-label="`${label} 파일 선택`" @change="onFiles(($event.target as HTMLInputElement).files)" />

    <div class="grid">
      <figure v-for="it in modelValue" :key="it.id" class="thumb">
        <img :src="it.dataUrl" :alt="`${label} 미리보기`" />
        <figcaption>
          <span class="nm" :title="it.name">{{ it.name }}</span>
          <div v-if="checking" class="qc" aria-live="polite">
            <span v-if="!qOf(it.id) || qOf(it.id).status === 'PENDING'" class="badge tone-neutral"><Loader2 :size="14" class="spin" /> 사진 검사 중…</span>
            <template v-else>
              <span class="badge" :class="`tone-${PHOTO_QUALITY_META[qOf(it.id).status].tone}`">
                <CircleCheck v-if="qOf(it.id).status === 'PASSED'" :size="14" /><TriangleAlert v-else :size="14" />
                {{ PHOTO_QUALITY_META[qOf(it.id).status].label }}
              </span>
              <dl v-if="qOf(it.id).result?.metrics" class="metrics">
                <dt>해상도</dt>
                <dd>{{ qOf(it.id).result!.metrics!.width }}×{{ qOf(it.id).result!.metrics!.height }}</dd>
                <dt>밝기</dt>
                <dd>{{ qOf(it.id).result!.metrics!.brightness }}</dd>
                <dt>선명도</dt>
                <dd>{{ qOf(it.id).result!.metrics!.sharpness }}</dd>
                <dt>검사</dt>
                <dd>{{ formatDateTime(qOf(it.id).result!.checkedAt) }}</dd>
              </dl>
            </template>
            <div v-if="qOf(it.id)?.status === 'ERROR'" class="problem err">
              <span>{{ qOf(it.id).error }} 그대로 진행할 수도 있어요.</span>
              <button type="button" class="btn btn-sm" @click="recheck(it)"><RotateCw :size="16" /> 재검사</button>
            </div>
            <div v-else-if="problemOf(it.id)" class="problem" :class="{ fail: qOf(it.id).status === 'FAILED' }">
              <ul>
                <li v-for="q in problemOf(it.id)!.result?.issues ?? []" :key="q">{{ PHOTO_ISSUE_MESSAGE[q] }}</li>
              </ul>
              <p v-if="qOf(it.id).ackAt" class="ack"><CircleCheck :size="14" /> 현재 사진 사용 · {{ qOf(it.id).ackBy }} · {{ formatDateTime(qOf(it.id).ackAt) }}</p>
              <p v-else-if="qOf(it.id).status === 'FAILED'" class="faint">이 사진으로는 진단할 수 없어요. 다시 찍어 주세요.</p>
              <div class="acts">
                <button type="button" class="btn btn-sm retake" @click="pick(it.id)"><Camera :size="16" /> 재촬영</button>
                <button v-if="qOf(it.id).status === 'WARNING' && !qOf(it.id).ackAt" type="button" class="btn btn-sm" @click="acknowledge(it.id)"><CircleCheck :size="16" /> 현재 사진 사용</button>
              </div>
              <figure v-if="exampleSrc && !qOf(it.id).ackAt" class="good">
                <img :src="exampleSrc" alt="잘 찍은 예시 사진" />
                <figcaption>이렇게 찍어 주세요</figcaption>
              </figure>
            </div>
          </div>
          <span class="acts">
            <button v-if="!problemOf(it.id)" type="button" class="btn btn-sm" @click="pick(it.id)"><RefreshCw :size="16" /> 다시 올리기</button>
            <button type="button" class="btn btn-sm btn-danger" :aria-label="`${it.name} 삭제`" @click="remove(it.id)"><Trash2 :size="16" /> 삭제</button>
          </span>
        </figcaption>
      </figure>

      <button
        v-if="modelValue.length < max"
        type="button"
        class="drop"
        :class="{ dragging }"
        :disabled="busy"
        @click="pick()"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <ImagePlus v-if="!busy" :size="34" aria-hidden="true" />
        <RefreshCw v-else :size="30" class="spin" aria-hidden="true" />
        <strong>{{ busy ? '사진 처리 중…' : '사진 선택 또는 끌어 놓기' }}</strong>
        <span class="faint"><Camera :size="14" /> 태블릿에서는 바로 촬영할 수 있습니다</span>
      </button>

      <figure v-if="exampleSrc && !modelValue.length" class="example">
        <img :src="exampleSrc" alt="촬영 예시" />
        <figcaption class="faint">촬영 예시</figcaption>
      </figure>
    </div>
    <details v-if="checking && history.length" class="qhist">
      <summary><History :size="14" /> 검사 이력 {{ history.length }}건</summary>
      <ul>
        <li v-for="(h, i) in history" :key="i">
          <span class="nm">{{ h.name }}</span>
          <span class="badge" :class="`tone-${PHOTO_QUALITY_META[h.status].tone}`">{{ PHOTO_QUALITY_META[h.status].label }}</span>
          <span class="faint">{{ h.checkedAt ? formatDateTime(h.checkedAt) : '-' }} · 교체됨</span>
        </li>
      </ul>
    </details>
    <p v-if="error" class="error-text" role="alert"><CircleAlert :size="16" /> {{ error }}</p>
  </div>
</template>

<style scoped>
.uploader {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.uploader.invalid {
  border-color: var(--danger);
  background: #fffafa;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.thumb,
.example {
  margin: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}
.thumb img,
.example img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}
.example {
  opacity: 0.75;
  border-style: dashed;
}
.example figcaption {
  padding: 6px 10px;
}
.thumb figcaption {
  display: grid;
  gap: 8px;
  padding: 10px;
}
.nm {
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qc .badge {
  font-size: var(--fs-xs);
}
.problem {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning);
  font-size: var(--fs-sm);
}
.problem strong {
  display: flex;
  align-items: center;
  gap: 4px;
}
.problem ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 2px;
  color: var(--text);
}
.retake {
  justify-self: start;
  border-color: var(--warning);
  color: var(--warning);
}
.good {
  margin: 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: var(--fs-xs);
}
.good img {
  width: 72px;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--success-border);
}
.acts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.drop {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  min-height: 210px;
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  cursor: pointer;
  color: var(--navy-700);
  padding: 16px;
}
.drop:hover,
.drop.dragging {
  border-color: var(--navy-600);
  background: var(--navy-50);
}
.drop .faint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.metrics {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.metrics dd {
  margin: 0;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.problem.fail {
  border-color: var(--danger-border);
  background: var(--danger-bg);
}
.problem.err {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  font-size: var(--fs-sm);
}
.problem.err .btn {
  justify-self: start;
}
.ack {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--success);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.qhist {
  font-size: var(--fs-sm);
}
.qhist summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--text-2);
}
.qhist ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.qhist li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
</style>
