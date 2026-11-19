import { defineConfig } from 'vitest/config';

// Several agent tests start a headless Chrome first; on a busy CI runner that can take well over the
// default 10 s (one run timed out at 30 s), so setup hooks get a full minute.
export default defineConfig({
  test: { hookTimeout: 60_000 },
});
