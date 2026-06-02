import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// 注册 Service Worker（vite-plugin-pwa autoUpdate 模式）。
// 新版本 SW 安装后立即接管，下次刷新加载新版本；无版本提示弹窗，对家庭记账这种自用 PWA 足够。
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
