import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout.jsx'
import DailyTracker from './pages/DailyTracker.jsx'
import History from './pages/History.jsx'
import Home from './pages/Home.jsx'
import MailAssistant from './pages/MailAssistant.jsx'
import Settings from './pages/Settings.jsx'
import Todo from './pages/Todo.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="tracker" element={<DailyTracker />} />
          <Route path="todo" element={<Todo />} />
          <Route path="mail" element={<MailAssistant />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
