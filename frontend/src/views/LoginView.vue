<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleAlert, CircleCheck, LogIn, Eye, EyeOff, Wrench } from 'lucide-vue-next'
import BrandLogo from '@/components/common/BrandLogo.vue'
import RobotHero from '@/components/common/RobotHero.vue'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage, USE_MOCK } from '@/api'
import { postLoginPath } from '@/utils/roleHome'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const form = reactive({ employeeId: '', password: '' })
const errors = reactive<{ employeeId?: string; password?: string }>({})
const error = ref<string | null>(null)
const loading = ref(false)
const showPw = ref(false)

/** 로그인 식별자: 아이디 (Mock 기본 계정은 T1001 같은 사번, 실서버는 tech1 형식 — 이메일 아님) */
const idLabel = '아이디'

/** 회원가입 직후 넘어오면 아이디를 채우고 안내 (주소창이 아닌 history state 로 전달) */
const signedUp = ref(false)
onMounted(() => {
  const st = window.history.state as { username?: unknown; signedUp?: unknown } | null
  if (typeof st?.username === 'string') form.employeeId = st.username
  signedUp.value = st?.signedUp === true
})

function validate() {
  const v = form.employeeId.trim()
  // [통합] 이메일 형식 검사 제거: 백엔드 dev 계정 아이디가 tech1·tech2·quality(이메일 아님)라 로그인이 막혔다. 틀린 값은 서버가 401로 거른다
  errors.employeeId = !v ? '아이디를 입력해 주세요.' : undefined
  errors.password = form.password ? undefined : '비밀번호를 입력해 주세요.'
  return !errors.employeeId && !errors.password
}

async function submit() {
  error.value = null
  if (!validate()) return
  loading.value = true
  try {
    // 역할은 화면에서 고르지 않고, 로그인 응답(서버)의 사용자 역할로 이동할 화면을 정한다
    const u = await auth.login(form.employeeId, form.password)
    void router.replace(postLoginPath(router, u.role, route.query.redirect))
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}

</script>

<template>
  <div class="login">
    <!-- 로고 + 소개 한 줄: 화면 왼쪽 맨 위 -->
    <BrandLogo tagline align="start" class="brand-corner" />
    <section class="intro">
      <span class="glow g1" aria-hidden="true" />
      <span class="glow g2" aria-hidden="true" />
      <!-- 로봇: 패널 가로·세로 가운데 (로고는 오른쪽 로그인 영역 위에) -->
      <div class="hero">
        <RobotHero />
      </div>
    </section>

    <section class="panel">
      <div class="panel-in">
      <form class="card form" novalidate @submit.prevent="submit">
        <h2>로그인</h2>
        <p class="muted">아이디와 비밀번호를 입력하세요. 역할에 맞는 화면으로 이동합니다.</p>

        <div v-if="signedUp && !error" class="callout tone-success" role="status"><CircleCheck :size="20" /> 회원가입이 완료되었어요. 로그인해 주세요.</div>
        <div v-if="error" class="callout tone-danger" role="alert"><CircleAlert :size="20" /> {{ error }}</div>

        <div class="field">
          <label for="eid" class="req">{{ idLabel }}</label>
          <input
            id="eid"
            v-model="form.employeeId"
            class="input"
            :class="{ invalid: errors.employeeId }"
            type="text"
            autocomplete="username"
            :placeholder="USE_MOCK ? '예) T1001' : '예) tech1'"
            :aria-invalid="!!errors.employeeId"
          />
          <p v-if="errors.employeeId" class="error-text">{{ errors.employeeId }}</p>
        </div>
        <div class="field">
          <label for="pw" class="req">비밀번호</label>
          <div class="pw">
            <input id="pw" v-model="form.password" :type="showPw ? 'text' : 'password'" class="input" :class="{ invalid: errors.password }" autocomplete="current-password" :aria-invalid="!!errors.password" />
            <button type="button" class="btn btn-ghost eye" :aria-label="showPw ? '비밀번호 숨기기' : '비밀번호 보기'" @click="showPw = !showPw">
              <component :is="showPw ? EyeOff : Eye" :size="20" />
            </button>
          </div>
          <p v-if="errors.password" class="error-text">{{ errors.password }}</p>
        </div>
        <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="loading">
          <LogIn :size="20" /> {{ loading ? '로그인 중…' : '로그인' }}
        </button>

        <p class="signup-link">계정이 없으신가요? <RouterLink to="/signup">회원가입</RouterLink></p>

        <!-- 비회원 고객 전용 (로그인 여부와 관계없이 고객 화면으로) -->
        <div class="or" role="separator" aria-label="또는"><span>또는</span></div>
        <div class="guest">
          <p>서비스 접수 고객은 로그인 없이 이용할 수 있어요.</p>
          <RouterLink to="/service" class="btn btn-lg btn-block btn-outline-primary"><Wrench :size="20" /> 고장 접수하기</RouterLink>
          <p class="track-link">접수한 서비스가 있나요? <RouterLink to="/service/track">접수 내역 조회</RouterLink></p>
        </div>
      </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
}
.intro {
  /* 화면 높이에 맞춰 고정 (줄 높이 계산 기준). 오른쪽 폼이 더 길면 스크롤해도 패널은 제자리 */
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  isolation: isolate;
  background: #fff;
  color: var(--text-2);
  /* 좌우 48px 여백: 로봇이 패널 끝에 닿아 잘리지 않게 */
  padding: 0 48px;
  display: grid;
  place-items: center;
}
/* 로고: 왼쪽 패널 위에 겹쳐 왼쪽 맨 위 (위 40px · 왼쪽 48px) */
.brand-corner {
  position: absolute;
  top: 40px;
  left: 48px;
  z-index: 2;
}
.panel-in {
  width: min(480px, 100%);
  display: grid;
  justify-items: center;
  gap: 24px;
}
.panel-in .form {
  width: 100%;
}
/* 로봇: 패널 가운데, 최대 너비 480px */
.hero {
  width: 100%;
  max-width: 480px;
  display: grid;
  justify-items: center;
}
/* 그라데이션 빛 (블러 처리된 원) */
.glow {
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  background: var(--gradient);
  filter: blur(80px);
  opacity: 0.55;
  pointer-events: none;
}
.g1 {
  width: 520px;
  height: 520px;
  top: -160px;
  right: -140px;
}
.g2 {
  width: 380px;
  height: 380px;
  bottom: -140px;
  left: -100px;
  opacity: 0.35;
}
.panel {
  display: grid;
  place-items: center;
  padding: 32px;
  background: var(--bg);
}
.form {
  width: min(480px, 100%);
  padding: 36px;
  display: grid;
  gap: 18px;
}
h2 {
  font-size: var(--fs-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
}
.pw {
  position: relative;
}
.pw .input {
  padding-right: 56px;
}
/* 또는 구분선 */
.or {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-3);
  font-size: var(--fs-sm);
}
.or::before,
.or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
/* 비회원 고객 영역: 가운데 정렬, 로그인 버튼보다 낮은 강조(흰 바탕 · 파란 테두리 · 파란 글자) */
.guest {
  display: grid;
  gap: 12px;
  text-align: center;
}
.guest > p:first-child {
  color: var(--text-2);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.btn-outline-primary {
  background: var(--surface);
  border-color: var(--primary);
  color: var(--primary);
  /* 좁은 화면에서 글자가 카드 밖으로 나가지 않게 줄바꿈 허용 */
  white-space: normal;
  text-align: center;
}
.btn-outline-primary:hover:not(:disabled) {
  background: var(--blue-50);
  border-color: var(--primary);
}
.track-link {
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.track-link a {
  font-weight: 700;
}
.signup-link {
  text-align: center;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.signup-link a {
  font-weight: 700;
}
.eye {
  position: absolute;
  right: 2px;
  top: 0;
  padding: 0 12px;
}
/* 휴대폰: 카드 여백만 줄여 버튼이 한 줄에 들어가게 (카드 디자인은 그대로) */
@media (max-width: 480px) {
  .panel {
    padding: 16px;
  }
  .form {
    padding: 24px 20px;
  }
}
/* 좁은 화면(1100px 이하): 왼쪽 패널을 숨기고 로그인 폼만 */
@media (max-width: 1100px) {
  .login {
    grid-template-columns: 1fr;
    align-content: start;
  }
  .intro {
    display: none;
  }
  /* 왼쪽 패널이 없을 때도 로고는 왼쪽 맨 위 (흐름 안에서 폼 위에) */
  .brand-corner {
    position: static;
    padding: 24px 32px 0;
  }
}
@media (max-width: 480px) {
  .brand-corner {
    padding: 16px 16px 0;
  }
}
</style>
