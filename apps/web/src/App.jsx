import { Routes, Route } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import ItemDetailPage from './pages/ItemDetailPage.jsx';
import ItemFormPage from './pages/ItemFormPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProfileSettingsPage from './pages/ProfileSettingsPage.jsx';
import MyItemsPage from './pages/MyItemsPage.jsx';
import MySwapsPage from './pages/MySwapsPage.jsx';
import PointsHistoryPage from './pages/PointsHistoryPage.jsx';
import AdminQueuePage from './pages/AdminQueuePage.jsx';
import AdminLiveItemsPage from './pages/AdminLiveItemsPage.jsx';
import AdminReportsPage from './pages/AdminReportsPage.jsx';
import AdminUserDetailPage from './pages/AdminUserDetailPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';

/**
 * P1-T5 — routing shell. All placeholder pages are now replaced by real
 * feature pages (Phases 3–5); the route map matches the §12 sitemap.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/items" element={<BrowsePage />} />
        <Route
          path="/items/new"
          element={
            <ProtectedRoute>
              <ItemFormPage />
            </ProtectedRoute>
          }
        />
        <Route path="/items/:id" element={<ItemDetailPage />} />
        <Route
          path="/items/:id/edit"
          element={
            <ProtectedRoute>
              <ItemFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/profile"
          element={
            <ProtectedRoute>
              <ProfileSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/items"
          element={
            <ProtectedRoute>
              <MyItemsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/swaps"
          element={
            <ProtectedRoute>
              <MySwapsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/points"
          element={
            <ProtectedRoute>
              <PointsHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/items/pending"
          element={
            <ProtectedRoute requireAdmin>
              <AdminQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/live"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLiveItemsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requireAdmin>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <ProtectedRoute requireAdmin>
              <AdminUserDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute requireAdmin>
              <AdminReportsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
