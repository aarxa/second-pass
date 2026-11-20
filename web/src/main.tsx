import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Editor } from './Editor';
import { Gallery } from './Gallery';
import { Home } from './Home';
import { HowItWorks } from './How';
import { Admin } from './Admin';
import { NewShader } from './NewShader';
import { Missing } from './Missing';
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
        <Route path="/how" element={<HowItWorks />} />
        <Route path="/agent" element={<Runs />} />
        <Route path="/agent/:id" element={<Replay />} />
        <Route path="/admin" element={<Admin />} />
        <Route
          path="*"
          element={<Missing title="This page doesn't exist" text="The address may be mistyped. Everything Second Pass has is a click away."><a className="btn" href="/">Home</a><a className="btn secondary" href="/gallery">Gallery</a></Missing>}
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
