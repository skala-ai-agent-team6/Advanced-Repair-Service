import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 실서버 연결: .env.development 의 VITE_USE_MOCK=false, VITE_API_PROXY_TARGET 에 백엔드 주소.
// 브라우저는 같은 origin(/api)으로 요청하고 Vite 가 백엔드로 프록시하므로 세션 쿠키·CSRF 가 그대로 동작한다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:8080'
  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: {
        // changeOrigin 은 끔: 백엔드 CORS·쿠키가 브라우저 origin(FRONTEND_ORIGIN) 기준으로 동작하도록 Host 를 유지
        '/api': { target, changeOrigin: false },
        // [출장] 소비자 비로그인 API (백엔드 /public/**)
        '/public': { target, changeOrigin: false },
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
    },
    define: { __APP_MODE__: JSON.stringify(mode) },
  }
})
