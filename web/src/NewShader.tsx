// /new: pick a starting point, then the shader is created with that code and opens in the editor.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiveShader } from './LiveShader';
import { TEMPLATES, type Template } from './templates';
import { TopBar } from './theme';

export function NewShader() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const start = async (t: Template) => {
    setCreating(t.id);
    setFailed(false);
    try {
      const res = await fetch('/api/shaders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: t.code }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      navigate(`/s/${id}`, { replace: true });
    } catch {
      setFailed(true);
      setCreating(null);
    }
  };

  return (
    <div className="page new-page">
      <TopBar />
      <main className="picker">
        <div className="picker-head">
          <h1>Start a new shader</h1>
          <p>Pick a starting point. It opens in the editor, where you can share the link and edit it with anyone.</p>
          {creating && <p className="waking" role="status">Creating it… if the server was asleep, waking it can take up to a minute.</p>}
          {failed && <p className="error-text" role="alert">Couldn't reach the server. Pick one again to retry.</p>}
        </div>
        <div className="templates">
          {TEMPLATES.map((t) => (
            <button key={t.id} className={`template${creating === t.id ? ' busy' : ''}`} onClick={() => start(t)} disabled={creating !== null}>
              <LiveShader code={t.code} label={t.title} startAt={2} />
              <span className="tt">{t.title}</span>
              <span className="tb">{t.blurb}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
