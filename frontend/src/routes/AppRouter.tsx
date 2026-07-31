import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Shell from '../components/Shell'
import AccountsPage from '../pages/AccountsPage'
import MaterialsPage from '../pages/MaterialsPage'
import CreatePage from '../pages/CreatePage'
import WorksPage from '../pages/WorksPage'
import MigrationPage from '../pages/MigrationPage'

export default function AppRouter() {
  return <BrowserRouter><Routes><Route element={<Shell />}>
    <Route index element={<Navigate to="/create" replace />} />
    <Route path="/accounts" element={<AccountsPage />} />
    <Route path="/materials" element={<MaterialsPage />} />
    <Route path="/create" element={<CreatePage />} />
    <Route path="/create/:accountId/:workflowId" element={<CreatePage />} />
    <Route path="/works" element={<WorksPage />} />
    <Route path="/migration" element={<MigrationPage />} />
    <Route path="/workspace" element={<Navigate to="/create" replace />} />
    <Route path="/material-bank" element={<Navigate to="/materials" replace />} />
    <Route path="/knowledge-base" element={<Navigate to="/works" replace />} />
    <Route path="*" element={<Navigate to="/create" replace />} />
  </Route></Routes></BrowserRouter>
}
