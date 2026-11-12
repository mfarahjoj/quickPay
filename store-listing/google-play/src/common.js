/* Shared helpers for the Zapp Pay Play graphics: glyphs, Android phone frame,
   status bar, notification card, store canvas. Load qr.js first. */

/* ── Glyphs ──────────────────────────────────────────── */
const CORAL = '#FF5043';
const bolt = (s = 20, c = CORAL) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M13.5 2 4 13.5h6.2L9.8 22 20 10.2h-6.6L13.5 2Z" fill="${c}"/></svg>`;
const appBolt = (s = 20, c = CORAL) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><polygon points="57,8 26,54 45,54 43,92 74,44 55,44" fill="${c}" stroke="${c}" stroke-width="4" stroke-linejoin="round"/></svg>`;
const plus = (s = 20, c = CORAL) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const cash = (s = 20, c = CORAL) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M3 8H21V18H3Z" stroke="${c}" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 15.5A2.5 2.5 0 1 0 12 10.5A2.5 2.5 0 0 0 12 15.5Z" stroke="${c}" stroke-width="1.9"/><path d="M7 5.5H17" stroke="${c}" stroke-width="1.9" stroke-linecap="round"/></svg>`;
const qrIcon = (s = 20, c = CORAL) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.9"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 19h1M20 14v1.5" stroke-linecap="round"/></svg>`;
const bell = (s = 18, c = '#fff') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M12 4A6 6 0 0 0 6 10V14L4.5 17H19.5L18 14V10A6 6 0 0 0 12 4ZM10 19.5A2 2 0 0 0 14 19.5" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const chevronLeft = (s = 18, c = '#fff') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const closeX = (s = 16, c = '#fff') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const check = (s = 18, c = '#fff', w = 2.6) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const fingerprint = (s = 22, c = '#fff') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round"><path d="M6.2 6.6A8 8 0 0 1 19.4 9"/><path d="M4.4 10.5a8 8 0 0 0-.2 1.8c0 1.6.3 3 .8 4.3"/><path d="M8 19.8c-.9-1.9-1.4-4.2-1.4-6.6a5.4 5.4 0 0 1 10.8 0v.6"/><path d="M12 13.2c0 3.1.8 5.8 2.2 7.6"/><path d="M9.3 13.2a2.7 2.7 0 0 1 5.4 0c0 2 .4 3.8 1.1 5.3"/><path d="M17.6 16.6c.2 1.2.6 2.3 1.1 3.2"/></svg>`;
const flashlight = (s = 20, c = '#fff') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"><path d="M7 3h10v4l-3 4v10h-4V11L7 7z"/><path d="M12 13v2" stroke-linecap="round"/></svg>`;

const statusIcons = `
  <svg width="17" height="12" viewBox="0 0 17 12"><rect x="0" y="8" width="3" height="4" rx="0.8" fill="#fff"/><rect x="4.6" y="5.5" width="3" height="6.5" rx="0.8" fill="#fff"/><rect x="9.2" y="3" width="3" height="9" rx="0.8" fill="#fff"/><rect x="13.8" y="0" width="3" height="12" rx="0.8" fill="#fff"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.6 15.4 3.4A10.6 10.6 0 0 0 .6 3.4Z" fill="#fff"/></svg>
  <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.6" y="0.6" width="21" height="10.8" rx="3" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.2"/><rect x="2.4" y="2.4" width="14.6" height="7.2" rx="1.6" fill="#fff"/><rect x="22.6" y="3.8" width="1.8" height="4.4" rx="0.9" fill="rgba(255,255,255,0.5)"/></svg>`;
const statusBar = (time = '9:41') => `<div class="sb"><span class="num">${time}</span><span class="icons">${statusIcons}</span></div>`;

/* QR (encodes https://zapppay.web.app — see qr.js) */
const qr = (size, fg = '#000') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${QR_N} ${QR_N}" shape-rendering="crispEdges"><path d="${QR_PATH}" fill="${fg}"/></svg>`;

const phone = (inner, style = '') =>
  `<div class="phone" style="${style}"><div class="screen"><div class="punch"></div>${inner}</div></div>`;


/* ── Store frames ────────────────────────────────────── */
const notif = (title, body, when = 'now') => `
  <div class="notif">
    <div class="mk">${bolt(20, '#fff')}</div>
    <div class="nt"><small><span>Zapp Pay</span><span>${when}</span></small><b>${title}</b><span>${body}</span></div>
  </div>`;

const shot = ({ eyebrow, h1, p, screen, extra = '', vars = '', phoneStyle = '', theme = '' }) => `
  <div class="canvas ${theme}" style="${vars}">
    <div class="bg"></div>
    <div class="copy">
      <div class="eyebrow">${eyebrow}</div>
      <h1>${h1}</h1>
      <p>${p}</p>
    </div>
    ${phone(screen, phoneStyle)}
    ${extra}
  </div>`;

function renderFrames(FRAMES) {
  const render = () => {
  const key = (location.hash || '#shot-1').slice(1);
    document.getElementById('root').innerHTML = (FRAMES[key] || FRAMES['shot-1'])();
  };
  window.addEventListener('hashchange', render);
  render();
}
