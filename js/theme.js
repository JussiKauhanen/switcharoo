// Light / dark theme. Follows the system until you flip the toggle.
// Loaded as a plain blocking script in <head> so the page never flashes the wrong theme.
(() => {
  const KEY = 'switcharoo.theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');

  let choice = null;
  try {
    choice = localStorage.getItem(KEY);
  } catch {
    /* private mode */
  }

  const apply = () => {
    const theme = choice || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0b1120' : '#eaf3ff');
  };

  apply();
  system.addEventListener?.('change', apply);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#theme')) return;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    // Picking what the system already uses means "follow the system" again.
    choice = next === (system.matches ? 'dark' : 'light') ? null : next;
    try {
      if (choice) localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode */
    }
    apply();
  });
})();
