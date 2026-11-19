// Where the server lives. On Render or Cloud Run the server also serves this site, so everything is
// same-origin. When the site is hosted separately (Netlify), API calls still go to /api/* and Netlify
// forwards them, but WebSockets can't be forwarded, so the live editor connects to the server
// directly: set VITE_COLLAB_URL (e.g. wss://second-pass-xxxx.run.app/collab) when building the site.
export function collabUrl(): string {
  const configured = import.meta.env.VITE_COLLAB_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/collab`;
}
