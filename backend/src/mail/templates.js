// Email templates: plain text plus simple, inline-styled HTML (mail clients ignore stylesheets).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1a1f29">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #dde3ec">
<tr><td style="background:#2d3e5a;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">CampusSeat</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}
const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#2447d6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;

export function passwordReset({ name, link, minutes }) {
  const first = String(name || '').split(' ')[0] || 'there';
  return {
    subject: 'Reset your CampusSeat password',
    text: `Hi ${first},\n\nSomeone (hopefully you) asked to reset the password for your CampusSeat account.\n\nSet a new password here (the link works once and expires in ${minutes} minutes):\n${link}\n\nIf you did not ask for this, ignore this email: your password stays the same.\n`,
    html: layout('Reset your password', `<p>Hi ${esc(first)},</p><p>Someone (hopefully you) asked to reset the password for your CampusSeat account.</p>
${button(link, 'Choose a new password')}<p style="color:#4a5568;font-size:14px">The link works once and expires in ${minutes} minutes. If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="color:#4a5568;font-size:14px">If you did not ask for this, ignore this email: your password stays the same.</p>`),
  };
}
