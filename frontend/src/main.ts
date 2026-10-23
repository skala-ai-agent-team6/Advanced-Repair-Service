import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { USE_MOCK } from './api/http'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './styles/tokens.css'
import './styles/base.css'

async function bootstrap() {
  if (USE_MOCK) {
    // Mock 모드: 새로고침 전에 진행 중이던 AI 분석을 이어서 실행
    const { resumeAll } = await import('./mocks/engine')
    resumeAll()
  }
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

void bootstrap()
