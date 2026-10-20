import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import SiteGate from './components/SiteGate'
import { useAuth } from './auth'
import HistoryPage from './pages/HistoryPage'
import LoginPage from './pages/LoginPage'
import MePage from './pages/MePage'
import RegisterPage from './pages/RegisterPage'
import ResearchPage from './pages/ResearchPage'

function Protected({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="spinner dark" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <Layout>{children}</Layout>
}

// 研究台对游客开放：未登录也能浏览行情、看 K 线；点击「开始研究」时才引导登录。
function PublicPage({ children }) {
  const { loading } = useAuth()
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="spinner dark" />
      </div>
    )
  }
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <SiteGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<PublicPage><ResearchPage /></PublicPage>} />
        <Route path="/history" element={<Protected><HistoryPage /></Protected>} />
        <Route path="/me" element={<Protected><MePage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SiteGate>
  )
}
