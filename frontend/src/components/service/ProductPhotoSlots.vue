<script setup lang="ts">
/* =========================================================================
 * 고객 고장 접수 2단계 — 제품 사진 칸 (가로 3칸: 제품 전체 · 고장 난 부분 · 촬영 예시)
 *  - 칸을 누르거나 사진을 끌어 놓으면 그 칸이 썸네일로 바뀜 ([×] 삭제 · 사진 품질 검사 결과 표시)
 *  - 두 칸 모두 필수 아님: 전체 1장 이상이면 다음 단계로 (부모가 검사)
 *  - 두 칸을 다 채우면 [+ 사진 추가]로 나머지 (전체 최대 max 장)
 *  - v-model: [제품 전체, 고장 난 부분, ...추가 사진] 순서의 사진 목록
 *  기사용 ImageUploader 는 그대로 두고 고객 화면에서만 쓰는 컴포넌트
 * ========================================================================= */
import { computed, reactive, ref, watch } from 'vue'
import { CircleAlert, CircleCheck, ImagePlus, Loader2, Plus, TriangleAlert, X } from 'lucide-vue-next'
import { checkPhotoQuality } from '@/api'
import { FEATURES } from '@/api/features'
import { compressImage, uid } from '@/utils/format'
import type { PhotoQualityResult } from '@/types'
import type { UploadItem } from '@/types/upload'

const props = withDefaults(defineProps<{ modelValue: UploadItem[]; max?: number; invalid?: boolean; exampleSrc?: string }>(), { max: 5, exampleSrc: '/mock/product.svg' })
const emit = defineEmits<{
  'update:modelValue': [UploadItem[]]
  /** 검사 중 · 문제 있는 사진 수 (부모의 경고·확인용) */
  quality: [summary: { checking: number; problems: number }]
}>()

const MAX_MB = 15
type SlotKey = 'whole' | 'part'
const SLOTS: { key: SlotKey; label: string }[] = [
  { key: 'whole', label: '제품 전체' },
  { key: 'part', label: '고장 난 부분' },
]
const slots = reactive<{ whole: UploadItem | null; part: UploadItem | null; extras: UploadItem[] }>({ whole: null, part: null, extras: [] })
const all = computed(() => [slots.whole, slots.part, ...slots.extras].filter((x): x is UploadItem => !!x))
const error = ref<string | null>(null)
const busy = ref<SlotKey | 'extra' | null>(null)
const dragging = ref<SlotKey | null>(null)
const input = ref<HTMLInputElement | null>(null)
let target: SlotKey | 'extra' = 'whole'

function emitAll() {
  emit('update:modelValue', all.value)
}

async function toItem(f: File): Promise<UploadItem | null> {
  if (!f.type.startsWith('image/')) {
    error.value = `${f.name}: 이미지 파일(JPG, PNG, HEIC)만 올릴 수 있어요.`
    return null
  }
  if (f.size > MAX_MB * 1024 * 1024) {
    error.value = `${f.name}: ${MAX_MB}MB 이하 사진만 올릴 수 있어요.`
    return null
  }
  return { id: uid('up'), file: f, dataUrl: await compressImage(f), name: f.name, size: f.size }
}

async function addFiles(files: FileList | File[] | null | undefined, to: SlotKey | 'extra') {
  const list = Array.from(files ?? [])
  if (!list.length) return
  error.value = null
  busy.value = to
  try {
    if (to === 'extra') {
      const room = props.max - all.value.length
      if (list.length > room) error.value = `사진은 최대 ${props.max}장까지 올릴 수 있어요.`
      for (const f of list.slice(0, Math.max(0, room))) {
        const it = await toItem(f)
        if (it) slots.extras.push(it)
      }
    } else {
      const it = await toItem(list[0])
      if (it) slots[to] = it
    }
    emitAll()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '사진을 읽지 못했어요.'
  } finally {
    busy.value = null
    if (input.value) input.value.value = ''
  }
}

function pick(to: SlotKey | 'extra') {
  target = to
  if (input.value) input.value.multiple = to === 'extra'
  input.value?.click()
}
function remove(to: SlotKey | string) {
  error.value = null
  if (to === 'whole' || to === 'part') slots[to] = null
  else slots.extras = slots.extras.filter((x) => x.id !== to)
  emitAll()
}
function onDrop(e: DragEvent, to: SlotKey) {
  dragging.value = null
  void addFiles(e.dataTransfer?.files, to)
}

/* ---------- 사진 품질 검사 (기존 검사 API · 결과 표시 유지) ---------- */
type QState = 'checking' | 'error' | PhotoQualityResult
const quality = reactive<Record<string, QState>>({})
const checkingOn = FEATURES.photoQualityCheck
watch(
  all,
  (items) => {
    if (!checkingOn) return
    for (const it of items) {
      if (quality[it.id]) continue
      quality[it.id] = 'checking'
      checkPhotoQuality(it.file, 'MOTOR')
        .then((q) => (quality[it.id] = q))
        // 검사 실패는 사진 문제로 보지 않음
        .catch(() => (quality[it.id] = 'error'))
    }
  },
  { immediate: true },
)
const qOf = (id: string) => quality[id]
/* [출장·시연 고정] 알림 조건 */
const wholeNeedsRetake = computed(() => !!slots.whole && !!problemOf(slots.whole.id))
const needsPartPhoto = computed(() => !!slots.part && !slots.extras.length)
const problemOf = (id: string) => {
  const q = quality[id]
  return typeof q === 'object' && !q.ok ? q : null
}
watch(
  () => ({
    checking: all.value.filter((it) => checkingOn && (!quality[it.id] || quality[it.id] === 'checking')).length,
    // [출장·시연 고정] 알림 2개: ① 1번 사진(제품 전체)에 문제 → 다시 올리기 ② 2번 사진(고장 난 부분) 뒤에 부품 사진 1장 추가
    problems: (wholeNeedsRetake.value ? 1 : 0) + (needsPartPhoto.value ? 1 : 0),
  }),
  (v) => emit('quality', v),
  { immediate: true, deep: true },
)
const canAddMore = computed(() => !!slots.whole && !!slots.part && all.value.length < props.max)
</script>

<template>
  <div class="photos" :class="{ invalid: invalid && !all.length }">
    <div class="head">
      <span class="label req">제품 사진</span>
      <span class="faint">1장 이상 · 최대 {{ max }}장</span>
    </div>

    <input ref="input" type="file" accept="image/*" class="sr-only" aria-label="제품 사진 파일 선택" @change="addFiles(($event.target as HTMLInputElement).files, target)" />

    <!-- 가로 3칸: 제품 전체 · 고장 난 부분 · 촬영 예시 -->
    <ul class="grid">
      <li v-for="s in SLOTS" :key="s.key" class="cell">
        <div v-if="slots[s.key]" class="box thumb">
          <img :src="slots[s.key]!.dataUrl" :alt="`${s.label} 사진`" />
          <button type="button" class="del" :aria-label="`${s.label} 사진 삭제`" @click="remove(s.key)"><X :size="16" /></button>
          <span v-if="checkingOn" class="qbadge" aria-live="polite">
            <span v-if="!qOf(slots[s.key]!.id) || qOf(slots[s.key]!.id) === 'checking'" class="badge tone-neutral"><Loader2 :size="13" class="spin" /><span class="qtxt">검사 중</span></span>
            <span v-else-if="problemOf(slots[s.key]!.id)" class="badge tone-warning"><TriangleAlert :size="13" /><span class="qtxt">확인 필요</span></span>
            <span v-else-if="qOf(slots[s.key]!.id) !== 'error'" class="badge tone-success"><CircleCheck :size="13" /><span class="qtxt">통과</span></span>
          </span>
        </div>
        <button
          v-else
          type="button"
          class="box drop"
          :class="{ dragging: dragging === s.key }"
          :disabled="!!busy"
          :aria-label="`${s.label} 사진 선택 또는 끌어 놓기`"
          @click="pick(s.key)"
          @dragover.prevent="dragging = s.key"
          @dragleave="dragging = null"
          @drop.prevent="onDrop($event, s.key)"
        >
          <Loader2 v-if="busy === s.key" :size="28" class="spin" aria-hidden="true" />
          <ImagePlus v-else :size="28" aria-hidden="true" />
          <span class="drop-txt">사진 선택 또는 끌어 놓기</span>
        </button>
        <span class="cap">{{ s.label }}</span>
      </li>
      <li class="cell">
        <div class="box example"><img :src="exampleSrc" alt="촬영 예시 사진" /></div>
        <span class="cap">촬영 예시</span>
      </li>
    </ul>

    <!-- 추가 사진 (두 칸을 다 채운 뒤) -->
    <ul v-if="slots.extras.length" class="extras">
      <li v-for="(it, i) in slots.extras" :key="it.id" class="extra">
        <img :src="it.dataUrl" :alt="`추가 사진 ${i + 1}`" />
        <button type="button" class="del" :aria-label="`추가 사진 ${i + 1} 삭제`" @click="remove(it.id)"><X :size="14" /></button>
        <span v-if="checkingOn && problemOf(it.id)" class="dot warn" aria-label="확인 필요" />
        <span v-else-if="checkingOn && typeof qOf(it.id) === 'object'" class="dot ok" aria-label="통과" />
      </li>
    </ul>
    <button v-if="canAddMore" type="button" class="btn btn-sm add" :disabled="!!busy" @click="pick('extra')">
      <Loader2 v-if="busy === 'extra'" :size="16" class="spin" /><Plus v-else :size="16" /> 사진 추가
    </button>

    <!-- [출장·시연 고정] 알림 2개 (각각 처리하면 사라짐) -->
    <div v-if="wholeNeedsRetake" class="notice warn" role="alert">
      <TriangleAlert :size="16" aria-hidden="true" />
      <span><b>1번 사진이 흐려요.</b> 초점을 맞춰 밝은 곳에서 다시 찍어 올려 주세요.</span>
      <button type="button" class="btn btn-sm retake" :disabled="!!busy" @click="pick('whole')">다시 올리기</button>
    </div>
    <div v-if="needsPartPhoto" class="notice info" role="alert">
      <Plus :size="16" aria-hidden="true" />
      <span><b>2번 사진의 부품을 더 자세히 봐야 해요.</b> 고장 난 부품이 잘 보이도록 가까이에서 한 장 더 찍어 추가해 주세요.</span>
      <button type="button" class="btn btn-sm add-part" :disabled="!!busy" @click="pick('extra')">사진 추가</button>
    </div>
    <p v-if="error" class="error-text" role="alert"><CircleAlert :size="16" /> {{ error }}</p>
  </div>
</template>

<style scoped>
.photos {
  display: grid;
  gap: 12px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
/* 가로 3칸 — 박스 안쪽 너비를 꽉 채움, 모두 같은 크기·정사각형 */
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.cell {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.box {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius);
  overflow: hidden;
  container-type: inline-size;
}
/* 업로드 칸: 점선 테두리 · 연한 파랑 hover (기존 업로드 칸과 같은 스타일) */
.drop {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  padding: 8px;
  border: 2px dashed var(--border-strong);
  background: var(--surface-2);
  color: var(--navy-700);
  cursor: pointer;
  text-align: center;
}
.drop:hover,
.drop.dragging {
  border-color: var(--navy-600);
  background: var(--navy-50);
}
.invalid .drop {
  border-color: var(--danger);
}
.drop-txt {
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.35;
}
/* 칸이 작으면 글씨는 숨기고 아이콘만 */
@container (max-width: 130px) {
  .drop-txt,
  .qtxt {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
.thumb,
.example {
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.thumb img,
.example img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.example {
  opacity: 0.85;
}
.del {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(11, 27, 63, 0.7);
  color: #fff;
  cursor: pointer;
}
.del:hover {
  background: var(--danger);
}
.qbadge {
  position: absolute;
  left: 6px;
  bottom: 6px;
}
.qbadge .badge {
  font-size: var(--fs-xs);
  padding: 2px 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
}
.cap {
  text-align: center;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-2);
}
/* 추가 사진 */
.extras {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.extra {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border);
}
.extra img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.extra .del {
  top: 3px;
  right: 3px;
  width: 22px;
  height: 22px;
}
.dot {
  position: absolute;
  left: 4px;
  bottom: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
}
.dot.ok {
  background: var(--success);
}
.dot.warn {
  background: var(--warning);
}
.add {
  justify-self: start;
}
/* 품질 검사 문제 안내 */
.problems {
  list-style: none;
  margin: 0;
  padding: 10px 12px;
  display: grid;
  gap: 8px;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  font-size: var(--fs-sm);
}
.problems li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.problems svg {
  flex: none;
  color: var(--warning);
}
.problems span {
  flex: 1 1 180px;
}
.retake {
  border-color: var(--warning);
  color: var(--warning);
}
/* [출장·시연 고정] 알림 2개: 노랑(다시 올리기) · 파랑(사진 추가) */
.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}
.notice span {
  flex: 1 1 180px;
}
.notice.warn {
  border: 1px solid var(--warning-border);
  background: var(--warning-bg);
}
.notice.warn svg {
  color: var(--warning);
}
.notice.info {
  border: 1px solid var(--info-border);
  background: var(--info-bg);
}
.notice.info svg {
  color: var(--info);
}
.add-part {
  border-color: var(--info);
  color: var(--info);
}
</style>
