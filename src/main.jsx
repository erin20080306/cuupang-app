import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// PWA 自動更新：偵測到新版本時自動刷新頁面
const updateSW = registerSW({
  onNeedRefresh() {
    // 有新版本時自動更新
    updateSW(true)
  },
  onOfflineReady() {
    console.log('PWA 離線模式已準備就緒')
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
