// /admin: the site owner saves the admin key (the server's ADMIN_TOKEN) in this browser. With it, the
// editor offers "Remove from gallery" on every gallery piece, not only the ones this browser added.
// The key never leaves the browser except as the Authorization header on that one request.
import { useState } from 'react';
import { adminKey, setAdminKey } from './keys';
import { SiteFooter, TopBar, usePageTitle } from './theme';

export function Admin() {
  const [saved, setSaved] = useState(() => adminKey() !== null);
  const [value, setValue] = useState('');
  usePageTitle('Site owner');
  return (
    <div className="page doc">
      <TopBar />
      <main className="wrap admin">
        <h1>Site owner</h1>
        <p>
          Paste the admin key you set as <code>ADMIN_TOKEN</code> on the server. It is kept only in this browser and lets
          you take any shader out of the gallery.
        </p>
        {saved ? (
          <div className="admin-row">
            <span className="ok-text">✓ This browser has the admin key.</span>
            <button className="secondary" onClick={() => { setAdminKey(null); setSaved(false); }}>Forget it</button>
          </div>
        ) : (
          <form
            className="admin-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!value.trim()) return;
              setAdminKey(value.trim());
              setValue('');
              setSaved(true);
            }}
          >
            <input id="admin-key" type="password" autoComplete="off" aria-label="Admin key" placeholder="Admin key" value={value} onChange={(e) => setValue(e.target.value)} />
            <button type="submit">Save in this browser</button>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
