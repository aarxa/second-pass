// A friendly random name and colour per browser, shown on your cursor to other editors.
// Accounts come later (see MILESTONES.md); until then this lives in localStorage.
const ADJ = ['Swift', 'Quiet', 'Bright', 'Lucky', 'Cosmic', 'Neon', 'Velvet', 'Amber', 'Misty', 'Brave'];
const NOUN = ['Otter', 'Comet', 'Fox', 'Pixel', 'Heron', 'Lynx', 'Nebula', 'Koi', 'Raven', 'Moth'];
export const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];
export const NAME_MAX = 24;

export interface Identity {
  name: string;
  color: string;
}

export function getIdentity(): Identity {
  try {
    const saved = localStorage.getItem('shaderlab.identity');
    if (saved) return JSON.parse(saved) as Identity;
  } catch {
    // private mode or blocked storage: fall through to a fresh identity
  }
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const id = { name: `${pick(ADJ)} ${pick(NOUN)}`, color: pick(COLORS) };
  try {
    localStorage.setItem('shaderlab.identity', JSON.stringify(id));
  } catch {
    // ignore
  }
  return id;
}

/** Saves a name and colour picked by the person (shown to others from the next change on). */
export function setIdentity(id: Identity): Identity {
  const clean = { name: id.name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX) || 'Someone', color: COLORS.includes(id.color) ? id.color : COLORS[0] };
  try {
    localStorage.setItem('shaderlab.identity', JSON.stringify(clean));
  } catch {
    // private mode: the choice lasts for this page
  }
  return clean;
}

export const initials = (name: string) => name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
