import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const NAVY = '#2d3e5a';
const ACCENT = '#c8611c';

/** CampusSeat logo drawn with vector shapes (a seat on a rounded badge). */
export function drawLogo(doc, x, y, size = 34) {
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.22).fill(ACCENT);
  const s = size / 34;
  doc.fillColor('#fff');
  doc.roundedRect(x + 9 * s, y + 6 * s, 16 * s, 12 * s, 3 * s).fill();
  doc.roundedRect(x + 7 * s, y + 20 * s, 20 * s, 6 * s, 3 * s).fill();
  doc.rect(x + 10 * s, y + 26 * s, 3 * s, 4 * s).fill();
  doc.rect(x + 21 * s, y + 26 * s, 3 * s, 4 * s).fill();
  doc.restore();
}

const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const hm = (t) => String(t).slice(0, 5);

export async function buildCard(res, b, filename) {
  const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 0, info: { Title: `Registration card ${b.booking_ref}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  const W = doc.page.width;
  const H = doc.page.height;

  doc.rect(0, 0, W, 78).fill(NAVY);
  drawLogo(doc, 28, 22, 34);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text('CampusSeat', 72, 24);
  doc.font('Helvetica').fontSize(10).fillColor('#cfd8e6').text('EVENT REGISTRATION CARD', 72, 49, { characterSpacing: 1.5 });

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(19).text(b.title, 28, 100, { width: W - 190 });
  const rows = [
    ['Name', b.full_name],
    ['Student / staff no.', b.student_number],
    ['School', b.school_name],
    ['Date', fmtDate(b.event_date)],
    ['Time', `${hm(b.start_time)} to ${hm(b.end_time)}`],
    ['Venue', b.venue],
  ];
  let y = 142;
  for (const [k, v] of rows) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#6b7686').text(k.toUpperCase(), 28, y, { characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#1a1f29').text(String(v), 150, y - 2, { width: W - 340 });
    y += 26;
  }

  const qr = await QRCode.toBuffer(b.booking_ref, { margin: 1, width: 220 });
  doc.image(qr, W - 142, 100, { width: 112 });
  doc.font('Helvetica').fontSize(8).fillColor('#6b7686').text('Scan at the entrance', W - 142, 215, { width: 112, align: 'center' });

  doc.rect(0, H - 62, W, 62).fill('#f3f5f9');
  doc.font('Helvetica').fontSize(8.5).fillColor('#6b7686').text('BOOKING REFERENCE', 28, H - 50, { characterSpacing: 0.8 });
  doc.font('Helvetica-Bold').fontSize(21).fillColor(ACCENT).text(b.booking_ref, 28, H - 36);
  doc.font('Helvetica').fontSize(8).fillColor('#6b7686').text('Present this card (printed or on your phone) at the venue.', W - 330, H - 36, { width: 302, align: 'right' });
  doc.end();
}

/** Generic tabular PDF report with logo, system name, date, filters, totals and page numbers. */
export function buildReport(res, { title, filters = [], columns, rows, totals = [], filename, orientation = 'portrait' }) {
  const doc = new PDFDocument({ size: 'A4', layout: orientation, margin: 40, bufferPages: true, info: { Title: title } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;

  const header = () => {
    drawLogo(doc, left, 36, 34);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text('CampusSeat', left + 44, 38);
    doc.font('Helvetica').fontSize(9).fillColor('#6b7686').text('Campus event seat booking system', left + 44, 59);
    doc.font('Helvetica').fontSize(9).fillColor('#6b7686').text(`Generated: ${new Date().toLocaleString('en-GB')}`, left, 42, { width: usable, align: 'right' });
    doc.moveTo(left, 80).lineTo(left + usable, 80).strokeColor('#c9d1de').lineWidth(1).stroke();
  };
  header();
  doc.fillColor('#1a1f29').font('Helvetica-Bold').fontSize(15).text(title, left, 92);
  doc.font('Helvetica').fontSize(9).fillColor('#4a5568');
  filters.forEach((f) => doc.text(f, left, doc.y + 1));
  doc.moveDown(0.6);

  const weights = columns.map((c) => c.w || 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * usable);
  const drawRow = (cells, { head = false, zebra = false } = {}) => {
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: widths[i] - 8 }))) + 8;
    if (doc.y + h > doc.page.height - 56) { doc.addPage(); header(); doc.y = 94; }
    const y = doc.y;
    if (head) doc.rect(left, y, usable, h).fill(NAVY);
    else if (zebra) doc.rect(left, y, usable, h).fill('#f3f5f9');
    let x = left;
    cells.forEach((c, i) => {
      doc.fillColor(head ? '#fff' : '#1a1f29').font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(c ?? ''), x + 4, y + 4, { width: widths[i] - 8 });
      x += widths[i];
    });
    doc.y = y + h;
  };
  drawRow(columns.map((c) => c.label), { head: true });
  if (!rows.length) { doc.fillColor('#6b7686').font('Helvetica-Oblique').fontSize(10).text('No records match the selected filters.', left, doc.y + 10); }
  rows.forEach((r, i) => drawRow(columns.map((c) => r[c.key]), { zebra: i % 2 === 1 }));
  if (totals.length) {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor(NAVY);
    totals.forEach((t) => doc.text(t, left, doc.y + 1));
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor('#6b7686')
      .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 30, { width: usable, align: 'center', lineBreak: false });
  }
  doc.end();
}

export const toCsv = (columns, rows) => {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\n');
};
