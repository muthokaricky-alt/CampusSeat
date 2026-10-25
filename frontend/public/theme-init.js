// Apply the saved theme before first paint so there is no light/dark flash.
// Kept as a separate file because the server's Content-Security-Policy blocks inline scripts.
try {
  var t = localStorage.getItem('campusseat_theme');
  if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
