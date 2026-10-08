import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PatientPage from './pages/PatientPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import DisplayPage from './pages/DisplayPage.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PatientPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="*" element={<PatientPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
