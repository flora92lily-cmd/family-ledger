import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import HomePage from './pages/HomePage'
import AddPage from './pages/AddPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import ImportPage from './pages/ImportPage'
import InvestPage from './pages/InvestPage'
import ReimbursementPage from './pages/ReimbursementPage'

function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const path = location.pathname

  if (path === '/add' || path === '/import' || path === '/reimbursements') return null

  return (
    <div className="tab-bar">
      <button className={`tab ${path === '/' ? 'active' : ''}`} onClick={() => navigate('/')}>
        <span className="tab-icon">🏠</span>
        <span>首页</span>
      </button>
      <button className={`tab ${path === '/stats' ? 'active' : ''}`} onClick={() => navigate('/stats')}>
        <span className="tab-icon">📊</span>
        <span>统计</span>
      </button>
      <button className="tab add-btn" onClick={() => navigate('/add')}>
        <span className="tab-icon">+</span>
      </button>
      <button className={`tab ${path === '/invest' ? 'active' : ''}`} onClick={() => navigate('/invest')}>
        <span className="tab-icon">📈</span>
        <span>投资</span>
      </button>
      <button className={`tab ${path === '/settings' ? 'active' : ''}`} onClick={() => navigate('/settings')}>
        <span className="tab-icon">⚙️</span>
        <span>设置</span>
      </button>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/add" element={<AddPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/invest" element={<InvestPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/reimbursements" element={<ReimbursementPage />} />
      </Routes>
      <TabBar />
    </BrowserRouter>
  )
}

export default App
