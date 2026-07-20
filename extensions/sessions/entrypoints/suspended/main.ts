import { isRestorableUrl } from '../../utils/model';

// The Chrome lazy-restore placeholder (PLAN.md §14.3). Chrome's `tabs.create` has
// no `discarded`, so a restored tab points HERE instead of at the real page. This
// page shows the saved title + favicon and makes 🔴 ZERO network requests until the
// tab is first shown — only when it becomes visible does it navigate to the real
// URL. That is what keeps restoring 200 tabs from loading 200 pages at once.
//
// 🔴 No innerHTML anywhere (guards): the DOM is built with createElement/textContent,
// so a hostile saved title can never inject markup. The target URL is validated with
// the same `isRestorableUrl` gate as capture — a `javascript:`/`data:` URL is never
// navigated to, it is shown inert.

interface Suspended {
  url: string;
  title: string;
  icon?: string;
}

function parseHash(): Suspended | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const url = params.get('u') ?? '';
  if (!isRestorableUrl(url)) return null;
  const icon = params.get('i') ?? undefined;
  return {
    url,
    title: params.get('t') || url,
    icon: icon && /^https?:\/\//i.test(icon) ? icon : undefined,
  };
}

function css(el: HTMLElement, styles: Record<string, string>): void {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v);
}

function render(data: Suspended): void {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const bg = dark ? '#1a1b1e' : '#f7f7f8';
  const fg = dark ? '#e6e6e8' : '#1a1b1e';
  const dim = dark ? '#9a9aa2' : '#6a6a72';

  document.title = data.title;
  css(document.body, { margin: '0' });

  const root = document.getElementById('root');
  if (!root) return;
  css(root, {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '14px',
    height: '100vh',
    'font-family': 'system-ui, sans-serif',
    background: bg,
    color: fg,
    padding: '24px',
    'box-sizing': 'border-box',
    'text-align': 'center',
  });

  if (data.icon) {
    const img = document.createElement('img');
    img.src = data.icon;
    img.alt = '';
    img.width = 48;
    img.height = 48;
    css(img, { width: '48px', height: '48px', 'border-radius': '8px' });
    img.addEventListener('error', () => img.remove());
    root.appendChild(img);
  }

  const h = document.createElement('h1');
  h.textContent = data.title;
  css(h, { 'font-size': '18px', 'font-weight': '600', margin: '0', 'max-width': '640px' });
  root.appendChild(h);

  const link = document.createElement('a');
  link.href = data.url;
  link.textContent = data.url;
  css(link, { color: dim, 'font-size': '13px', 'text-decoration': 'none', 'word-break': 'break-all' });
  root.appendChild(link);

  const hint = document.createElement('p');
  hint.textContent = 'Suspended to save memory — opens when you view this tab.';
  css(hint, { color: dim, 'font-size': '12px', margin: '4px 0 0' });
  root.appendChild(hint);
}

function go(url: string): void {
  // `replace` so the placeholder does not sit in the tab's back-history.
  location.replace(url);
}

const data = parseHash();
if (data) {
  render(data);
  if (document.visibilityState === 'visible') {
    go(data.url);
  } else {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
        go(data.url);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
  }
}
