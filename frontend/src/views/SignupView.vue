<script setup lang="ts">
/* =========================================================================
 * 회원가입 — 이름 · 아이디 · 비밀번호 · 담당 역할(필수)
 *  역할은 가입할 때 저장되고, 로그인 화면에서는 다시 고르지 않는다 (로그인 응답의 역할로 이동)
 *  실서버: 회원가입 API 가 아직 없어 FEATURES.signup 이 false 면 안내만 보이고 가입 버튼은 비활성
 * ========================================================================= */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CircleAlert, Eye, EyeOff, Info, UserPlus } from 'lucide-vue-next'
import BrandLogo from '@/components/common/BrandLogo.vue'
import { authApi } from '@/api/auth'
import { FEATURES } from '@/api/features'
import { toErrorMessage, USE_MOCK } from '@/api'
import type { Role, TechnicianType } from '@/types'

const router = useRouter()
const available = USE_MOCK || FEATURES.signup

const ROLES: { value: Role; label: string; desc: string }[] = [
  { value: 'TECHNICIAN', label: '서비스센터·출장기사', desc: '수리 접수 · 진단 확인 · 출장 수리' },
  { value: 'QUALITY_MANAGER', label: '본사 품질 담당자', desc: '발주 승인 · 품질 통계' },
]

/** 기사(TECHNICIAN)를 고르면 기사 유형도 필수 */
const TECH_TYPES: { value: TechnicianType; label: string; desc: string }[] = [
  { value: 'FIELD', label: '출장기사', desc: '고객 방문 · 출장 수리' },
  { value: 'CENTER', label: '센터 수리자', desc: '서비스센터 입고 수리' },
]

const form = reactive({ name: '', username: '', password: '', password2: '', role: '' as Role | '', technicianType: '' as TechnicianType | '' })
const touched = ref(false)
// 본사 품질 담당자를 고르면 기사 유형은 숨기고 값도 비움
watch(
  () => form.role,
  (role) => {
    if (role !== 'TECHNICIAN') form.technicianType = ''
  },
)
const showPw = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

const errs = computed(() => ({
  name: !form.name.trim() ? '이름을 입력해 주세요.' : null,
  username: !/^[A-Za-z0-9._-]{3,30}$/.test(form.username.trim()) ? '아이디는 영문·숫자 3~30자로 입력해 주세요.' : null,
  password: form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password) ? '비밀번호는 영문과 숫자를 섞어 8자 이상으로 입력해 주세요.' : null,
  password2: form.password2 !== form.password || !form.password2 ? '비밀번호가 일치하지 않아요.' : null,
  role: !form.role ? '담당 역할을 선택해 주세요.' : null,
  technicianType: form.role === 'TECHNICIAN' && !form.technicianType ? '기사 유형을 선택해 주세요.' : null,
}))
const invalid = computed(() => Object.values(errs.value).some(Boolean))

async function submit() {
  touched.value = true
  error.value = null
  if (invalid.value || !form.role) {
    // 오류 표시가 그려진 뒤 첫 번째 잘못된 칸으로 이동
    await nextTick()
    document.querySelector<HTMLElement>('input[aria-invalid="true"], .roles[aria-invalid="true"] input')?.focus()
    return
  }
  loading.value = true
  try {
    await authApi.signup({
      name: form.name,
      username: form.username,
      password: form.password,
      role: form.role,
      technicianType: form.role === 'TECHNICIAN' && form.technicianType ? form.technicianType : undefined,
    })
    // 로그인 화면으로: 아이디만 채워 두고 비밀번호는 다시 입력 (주소창이 아닌 history state 로 전달)
    void router.replace({ name: 'login', state: { username: form.username.trim(), signedUp: true } })
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="signup">
    <BrandLogo hide-when-empty :max-width="320" :height="72" class="logo" />

    <form class="card form-card form form-grid" novalidate @submit.prevent="submit">
      <div class="span-2 head">
        <h2>회원가입</h2>
        <p class="muted">담당 역할은 가입할 때 정하며, 로그인하면 역할에 맞는 화면으로 이동합니다.</p>
      </div>

      <p v-if="!available" class="callout tone-info span-2"><Info :size="20" /> 회원가입은 아직 준비 중이에요. 관리자에게 계정 발급을 요청해 주세요.</p>
      <div v-if="error" class="callout tone-danger span-2" role="alert"><CircleAlert :size="20" /> {{ error }}</div>

      <div class="field">
        <label for="su-name" class="req">이름</label>
        <input id="su-name" v-model="form.name" class="input" :class="{ invalid: touched && errs.name }" maxlength="30" autocomplete="name" :aria-invalid="touched && !!errs.name" />
        <p v-if="touched && errs.name" class="error-text">{{ errs.name }}</p>
      </div>
      <div class="field">
        <label for="su-id" class="req">아이디</label>
        <input id="su-id" v-model="form.username" class="input" :class="{ invalid: touched && errs.username }" maxlength="30" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="영문·숫자 3~30자" :aria-invalid="touched && !!errs.username" />
        <p v-if="touched && errs.username" class="error-text">{{ errs.username }}</p>
      </div>
      <div class="field">
        <label for="su-pw" class="req">비밀번호</label>
        <div class="pw">
          <input id="su-pw" v-model="form.password" :type="showPw ? 'text' : 'password'" class="input" :class="{ invalid: touched && errs.password }" autocomplete="new-password" placeholder="영문·숫자 포함 8자 이상" :aria-invalid="touched && !!errs.password" />
          <button type="button" class="btn btn-ghost eye" :aria-label="showPw ? '비밀번호 숨기기' : '비밀번호 보기'" @click="showPw = !showPw">
            <component :is="showPw ? EyeOff : Eye" :size="20" />
          </button>
        </div>
        <p v-if="touched && errs.password" class="error-text">{{ errs.password }}</p>
      </div>
      <div class="field">
        <label for="su-pw2" class="req">비밀번호 확인</label>
        <input id="su-pw2" v-model="form.password2" :type="showPw ? 'text' : 'password'" class="input" :class="{ invalid: touched && errs.password2 }" autocomplete="new-password" :aria-invalid="touched && !!errs.password2" />
        <p v-if="touched && errs.password2" class="error-text">{{ errs.password2 }}</p>
      </div>

      <!-- 담당 업무: 역할(필수) + 기사 유형(기사일 때만, 필수) -->
      <section class="span-2 duty" aria-labelledby="su-duty">
        <h3 id="su-duty" class="duty-h">담당 업무</h3>
        <fieldset class="field roles" :aria-invalid="touched && !!errs.role" aria-describedby="su-role-err">
          <legend class="req">담당 역할</legend>
          <div class="opts">
            <label v-for="r in ROLES" :key="r.value" class="role-opt" :class="{ on: form.role === r.value, invalid: touched && errs.role }">
              <input v-model="form.role" type="radio" name="role" :value="r.value" />
              <span class="role-txt">
                <strong>{{ r.label }}</strong>
                <small>{{ r.desc }}</small>
              </span>
            </label>
          </div>
          <p v-if="touched && errs.role" id="su-role-err" class="error-text" role="alert">{{ errs.role }}</p>
        </fieldset>

        <fieldset v-if="form.role === 'TECHNICIAN'" class="field roles" :aria-invalid="touched && !!errs.technicianType" aria-describedby="su-type-err">
          <legend class="req">기사 유형</legend>
          <div class="opts">
            <label v-for="t in TECH_TYPES" :key="t.value" class="role-opt" :class="{ on: form.technicianType === t.value, invalid: touched && errs.technicianType }">
              <input v-model="form.technicianType" type="radio" name="technicianType" :value="t.value" />
              <span class="role-txt">
                <strong>{{ t.label }}</strong>
                <small>{{ t.desc }}</small>
              </span>
            </label>
          </div>
          <p v-if="touched && errs.technicianType" id="su-type-err" class="error-text" role="alert">{{ errs.technicianType }}</p>
        </fieldset>
      </section>

      <button type="submit" class="btn btn-primary btn-lg btn-block span-2" :disabled="loading || !available">
        <UserPlus :size="20" /> {{ loading ? '가입 중…' : '회원가입' }}
      </button>
      <p class="login-link span-2">이미 계정이 있으신가요? <RouterLink to="/login">로그인</RouterLink></p>
    </form>
  </div>
</template>

<style scoped>
.signup {
  min-height: 100vh;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 20px;
  padding: 32px 16px;
  background: var(--bg);
}
/* 고장 접수와 같은 폼 너비·여백·간격 (토큰) — 데스크톱 2열, 1023px 이하 1열 */
.form {
  width: calc(100% - 40px);
  max-width: var(--form-max-w);
}
.head {
  display: grid;
  gap: 4px;
}
.duty {
  display: grid;
  gap: var(--field-gap);
  padding: 20px;
  border-radius: var(--radius);
  background: var(--surface-2);
}
.duty-h {
  margin: 0;
  font-size: var(--fs-md);
}
.opts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
@media (min-width: 1024px) {
  .opts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .form {
    width: 100%;
  }
  .duty {
    padding: 16px;
  }
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
.eye {
  position: absolute;
  right: 2px;
  top: 0;
  padding: 0 12px;
}
/* 담당 역할: 라디오 카드 (원형 라디오가 보이는 선택 카드) */
.roles {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
  gap: 8px;
}
.roles legend {
  font-weight: 600;
  margin-bottom: 6px;
  padding: 0;
}
.role-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}
.role-opt:hover {
  border-color: var(--primary);
}
.role-opt.on {
  border-color: var(--primary);
  background: var(--blue-50);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.role-opt.invalid {
  border-color: var(--danger);
}
.role-opt input {
  width: 20px;
  height: 20px;
  flex: none;
  margin: 0;
  accent-color: var(--primary);
}
.role-opt input:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}
.role-txt {
  display: grid;
}
.role-txt small {
  color: var(--text-3);
  font-size: var(--fs-xs);
}
.login-link {
  text-align: center;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.login-link a {
  font-weight: 700;
}

</style>
