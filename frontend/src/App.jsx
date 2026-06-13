import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import TraderDetail from './pages/TraderDetail'

function App() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/trader/:coin" element={<TraderDetail />} />
      </Routes>
    </div>
  )
}

export default App
