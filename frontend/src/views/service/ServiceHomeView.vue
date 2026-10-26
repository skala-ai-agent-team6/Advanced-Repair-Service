<script setup lang="ts">
/* =========================================================================
 * 고객 서비스 홈 (/service) — 로그인 없이 들어오는 첫 화면, 모바일 우선 · 데스크톱 2열
 *  히어로(제목·한 줄 설명·[AS 접수하기] + 움직이는 로봇) → 간편한 AS 접수(3단계) → 이미 접수하셨나요?(바로 조회)
 * ========================================================================= */
import BrandLogo from '@/components/common/BrandLogo.vue'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Camera, ChevronRight, CircleAlert, FileText, Search, Wrench } from 'lucide-vue-next'
import RobotHero from '@/components/common/RobotHero.vue'

const router = useRouter()

const STEPS = [
  { icon: FileText, title: '제품 정보' },
  { icon: Camera, title: '증상 · 사진' },
  { icon: Wrench, title: '기사 방문' },
]

/* ---------- 바로 조회: 두 값을 history state 로 넘겨 조회 화면에서 바로 결과 (주소창에 남기지 않음) ---------- */
const q = reactive({ receiptNo: '', last4: '' })
const touched = ref(false)
const errs = computed(() => ({
  receiptNo: !q.receiptNo.trim() ? '접수번호를 입력해 주세요.' : null,
  last4: !/^\d{4}$/.test(q.last4) ? '뒤 4자리를 숫자로 입력해 주세요.' : null,
}))
function track() {
  touched.value = true
  if (errs.value.receiptNo || errs.value.last4) return
  void router.push({ path: '/service/track', state: { receiptNo: q.receiptNo.trim(), last4: q.last4, auto: true } })
}
</script>

<template>
  <div class="home">
    <!-- 브랜드: 위쪽 가운데 전체 로고 + 서비스 소개 -->
    <BrandLogo tagline class="home-brand" />
    <!-- 히어로 -->
    <section class="hero" aria-labelledby="h-hero">
      <span class="glow" aria-hidden="true" />
      <div class="hero-text">
        <h1 id="h-hero">고장 증상과 사진을<br />미리 보내주세요</h1>
        <p class="lead">AI가 먼저 확인하고, 기사님이 부품을 챙겨 방문해요</p>
        <RouterLink to="/service/request" class="btn btn-primary btn-lg cta">AS 접수하기 <ArrowRight :size="20" /></RouterLink>
      </div>
      <div class="hero-robot">
        <RobotHero />
      </div>
    </section>

    <!-- 간편한 AS 접수 -->
    <section aria-labelledby="h-steps">
      <h2 id="h-steps" class="sec">간편한 AS 접수</h2>
      <ol class="steps">
        <template v-for="(s, i) in STEPS" :key="s.title">
          <li class="card step">
            <span class="no">{{ i + 1 }}</span>
            <span class="ic"><component :is="s.icon" :size="28" aria-hidden="true" /></span>
            <strong>{{ s.title }}</strong>
          </li>
          <li v-if="i < STEPS.length - 1" class="arrow" aria-hidden="true"><ChevronRight :size="24" /></li>
        </template>
      </ol>
    </section>

    <!-- 이미 접수하셨나요? -->
    <section class="card lookup" aria-labelledby="h-lookup">
      <h2 id="h-lookup" class="lookup-title"><span class="lookup-ic"><Search :size="22" aria-hidden="true" /></span> 이미 접수하셨나요?</h2>
      <form class="lookup-form" novalidate @submit.prevent="track">
        <div class="field">
          <label for="h-no" class="sr-only">접수번호</label>
          <input id="h-no" v-model="q.receiptNo" class="input mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="예) SR-2026-01544" :class="{ invalid: touched && errs.receiptNo }" :aria-invalid="touched && !!errs.receiptNo" />
        </div>
        <div class="field">
          <label for="h-last4" class="sr-only">휴대폰 번호 뒤 4자리</label>
          <input
            id="h-last4"
            v-model="q.last4"
            class="input mono"
            inputmode="numeric"
            maxlength="4"
            autocomplete="off"
            placeholder="휴대폰 번호 뒤 4자리"
            :class="{ invalid: touched && errs.last4 }"
            :aria-invalid="touched && !!errs.last4"
            @input="q.last4 = q.last4.replace(/\D/g, '').slice(0, 4)"
          />
        </div>
        <button type="submit" class="btn btn-primary btn-lg go">조회하기 <ArrowRight :size="20" /></button>
        <p v-if="touched && (errs.receiptNo || errs.last4)" class="error-text err" role="alert"><CircleAlert :size="16" /> {{ errs.receiptNo ?? errs.last4 }}</p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 28px;
}

/* ---------- 히어로 ---------- */
.hero {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 32px 22px 12px;
  border-radius: var(--radius-lg);
  background: linear-gradient(160deg, var(--blue-50) 0%, var(--surface) 70%);
}
/* 연한 파랑 빛 (기존 그라데이션 토큰을 흐리게) */
.glow {
  position: absolute;
  z-index: -1;
  width: 420px;
  height: 420px;
  right: -140px;
  top: -160px;
  border-radius: 50%;
  background: var(--gradient);
  filter: blur(80px);
  opacity: 0.35;
  pointer-events: none;
}
.hero-text {
  display: grid;
  gap: 14px;
  justify-items: start;
}
h1 {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.lead {
  color: var(--text-2);
}
.cta {
  margin-top: 4px;
}
.hero-robot {
  display: grid;
  justify-items: center;
}

/* ---------- 간편한 AS 접수 ---------- */
.sec {
  font-size: var(--fs-lg);
  font-weight: 700;
  margin: 0 0 12px;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
}
.no {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
  font-size: var(--fs-sm);
}
.ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--blue-50);
  color: var(--primary);
}
.step strong {
  font-size: var(--fs-lg);
}
/* 모바일: 세로로 쌓이므로 › 를 아래 방향으로 */
.arrow {
  display: grid;
  place-items: center;
  color: var(--text-3);
  transform: rotate(90deg);
}

/* ---------- 이미 접수하셨나요? ---------- */
.lookup {
  display: grid;
  gap: 14px;
  padding: 22px 20px;
}
.lookup-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: var(--fs-lg);
}
.lookup-ic {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--blue-50);
  color: var(--primary);
}
.lookup-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
.go {
  width: 100%;
}

/* ---------- 데스크톱: 2열 ---------- */
@media (min-width: 900px) {
  .hero {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 24px;
    padding: 48px 48px;
  }
  h1 {
    font-size: 2.8rem;
  }
  .steps {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
  }
  .step {
    flex-direction: column;
    text-align: center;
    padding: 24px 16px;
  }
  .arrow {
    transform: none;
  }
  .lookup {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 24px;
    padding: 24px 28px;
  }
  .lookup-form {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
    align-items: start;
  }
  .go {
    width: auto;
  }
  .err {
    grid-column: 1 / -1;
  }
}
</style>
