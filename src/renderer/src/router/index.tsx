import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../layouts/AppShell'
import { ChatPage } from '../pages/ChatPage'
import { TasksPage } from '../pages/TasksPage'

export const AppRouter = () => {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  )
}
