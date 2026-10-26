// Run: node tests/session-scope.mjs (uses the existing Vite/Pinia dependencies).
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

process.env.VITE_USE_MOCK = 'false'
globalThis.window = new EventTarget()
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { authApi } = await server.ssrLoadModule('/src/api/auth.ts')
  const { http } = await server.ssrLoadModule('/src/api/http.ts')
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/auth.ts')
  const { useFieldVisits } = await server.ssrLoadModule('/src/composables/useFieldVisits.ts')
  setActivePinia(createPinia())
  const auth = useAuthStore()
  const fieldUser = { id: 1, employeeId: 'field-tech', role: 'TECHNICIAN', technicianType: 'FIELD' }
  auth.user = fieldUser
  let expired = 0
  window.addEventListener('auth:expired', () => { expired++ })
  authApi.me = async () => fieldUser
  await auth.verifySession()
  assert.equal(expired, 0, 'Matching field session must remain logged in')
  authApi.me = async () => ({ ...fieldUser, employeeId: 'quality', role: 'QUALITY_MANAGER' })
  await auth.verifySession()
  assert.equal(expired, 1, 'Changed server identity must require login')
  authApi.me = async () => { throw new Error('network unavailable') }
  await auth.verifySession()
  assert.equal(expired, 1, 'Network failure must not expire the session')

  const field = useFieldVisits()
  let rejectRequest
  http.defaults.adapter = () => new Promise((_, reject) => { rejectRequest = reject })
  const pending = field.load()
  while (!rejectRequest) await Promise.resolve()
  auth.user = { ...fieldUser, employeeId: 'quality', role: 'QUALITY_MANAGER' }
  rejectRequest(new Error('old account request failed'))
  await pending
  assert.equal(field.error.value, null, 'Late error from old identity must be ignored')
  assert.deepEqual(field.visits.value, [])
  console.log('PASS: matching session, changed identity, network failure, stale field request (4 checks)')
} finally {
  await server.close()
}
