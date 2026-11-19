import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { Editor } from './Editor';
import { Gallery } from './Gallery';
import { Home } from './Home';
import { Runs } from './Runs';
import { Replay } from './Replay';
import './styles.css';

// "/new" creates a fresh shader and redirects to its share link. The request is shared module-wide
// so React StrictMode's double effect run in development doesn't create two shaders.
let creating: Promise<{ id: string }> | null = null;

function NewShader() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    creating ??= fetch('/api/shaders', { method: 'POST' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    creating
      .then(({ id }) => navigate(`/s/${id}`, { replace: true }))
      .catch(() => setFailed(true))
      .finally(() => { creating = null; });
  }, [navigate, attempt]);
  if (failed) {
    return (
      <div className="center">
        <div>
          <p>Couldn't reach the server to create a shader.</p>
          <button onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>Try again</button>
        </div>
      </div>
    );
  }
  // The server sleeps when nobody has used it for a while (free hosting); waking it takes up to a minute.
  return <div className="center">Creating a shader… <br />If the server was asleep, this can take up to a minute.</div>;
}

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
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
