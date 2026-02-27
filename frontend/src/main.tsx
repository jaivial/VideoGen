import React from 'react'
import ReactDOM from 'react-dom/client'
import { Routes, BrowserRouter, Route, Navigate } from 'react-router-dom'
import './index.css'

// Pages
import Login from './pages/login/+Page'
import Register from './pages/register/+Page'
import Settings from './pages/settings/+Page'
import Generate from './pages/generate/+Page'
import Library from './pages/library/+Page'
import Editor from './pages/editor/+Page'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Navigate to="/generate" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/generate" element={<Generate />} />
        <Route path="/library" element={<Library />} />
        <Route path="/editor/:videoId" element={<Editor />} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
