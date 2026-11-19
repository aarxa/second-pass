import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Editor } from './Editor';
import { Gallery } from './Gallery';
import { Home } from './Home';
import { Admin } from './Admin';
import { NewShader } from './NewShader';
import { Runs } from './Runs';
import { Replay } from './Replay';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewShader />} />
        <Route path="/s/:id" element={<Editor />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/agent" element={<Runs />} />
        <Route path="/agent/:id" element={<Replay />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
