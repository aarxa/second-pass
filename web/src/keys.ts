// Keys that take shaders out of the gallery. There are no accounts: adding a shader returns a random
// owner key, kept here in this browser only, and the site owner can save an admin key on /admin.
// Each is sent as "Authorization: Bearer <key>" when taking a shader out.
const OWNER_KEYS = 'secondpass.keys';
const ADMIN_KEY = 'secondpass.admin';

function readKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OWNER_KEYS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveOwnerKey(id: string, key: string) {
  try {
    localStorage.setItem(OWNER_KEYS, JSON.stringify({ ...readKeys(), [id]: key }));
  } catch {
    /* storage unavailable (private mode): only the admin key can take it out later */
  }
}

export function forgetOwnerKey(id: string) {
  const keys = readKeys();
  delete keys[id];
  try {
    localStorage.setItem(OWNER_KEYS, JSON.stringify(keys));
  } catch {
    /* nothing to forget */
  }
}

export function adminKey(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}

export function setAdminKey(key: string | null) {
  try {
    if (key) localStorage.setItem(ADMIN_KEY, key);
    else localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The key this browser would use to take shader `id` out of the gallery, if it has one. */
export function removalKey(id: string): string | null {
  return readKeys()[id] ?? adminKey();
}
