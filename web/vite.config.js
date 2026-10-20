import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // host: true = 监听 0.0.0.0，允许局域网内其他设备（如手机）访问。
    // 手机与电脑连同一 WiFi 后，用 http://<电脑局域网IP>:5173 打开。
    host: true,
    proxy: {
      // 开发期把 /api 代理到后端，前端代码里只写相对路径，
      // 部署时换 nginx 反代即可，不用改代码
      '/api': {
        target: 'http://127.0.0.1:8322',
        changeOrigin: true,
      },
    },
  },
})
