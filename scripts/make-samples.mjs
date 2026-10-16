// Generates small but real sample files (one per supported type) into supabase/sample/files
// so the local library has something to open in every reader.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';

const out = join(import.meta.dirname, '..', 'supabase', 'sample', 'files');
mkdirSync(out, { recursive: true });
const write = (name, buf) => { writeFileSync(join(out, name), buf); console.log('wrote', name, buf.length, 'bytes'); };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chapters = [
  ['Pharmacokinetics', ['Absorption, distribution, metabolism and excretion (ADME) decide how much drug reaches its target.', 'First-pass metabolism in the liver lowers the bioavailability of many oral drugs.', 'Half-life tells you how long it takes for the plasma level to fall by 50 percent.']],
  ['Autonomic nervous system drugs', ['Cholinergic agonists mimic acetylcholine at muscarinic and nicotinic receptors.', 'Mnemonic SLUDGE: salivation, lacrimation, urination, defecation, GI upset, emesis.', 'Anticholinergics such as atropine block muscarinic receptors.']],
  ['Cardiovascular drugs', ['Beta blockers lower heart rate and contractility.', 'ACE inhibitors can cause a dry cough and hyperkalemia.', 'Loop diuretics act on the thick ascending limb of the loop of Henle.']],
];

// ---- EPUB (EPUB 3 with a nav document)
async function epub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const items = chapters.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">mednotes-pharmacology-sample</dc:identifier><dc:title>Pharmacology Made Easy</dc:title><dc:creator>Dr. A. Santos, RPh, MD</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-16T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items}</manifest><spine>${spine}</spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map(([t], i) => `<li><a href="c${i + 1}.xhtml">Chapter ${i + 1} · ${esc(t)}</a></li>`).join('')}</ol></nav></body></html>`);
  chapters.forEach(([t, ps], i) => zip.file(`OEBPS/c${i + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(t)}</title></head><body><p style="letter-spacing:2px;color:#64748B">CHAPTER ${i + 1}</p><h1>${esc(t)}</h1>${ps.map((p) => `<p>${esc(p)}</p>`).join('')}${'<p>Sample text for the MedNotes reader. </p>'.repeat(12)}</body></html>`));
  write('pharmacology-made-easy.epub', await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));
}

// ---- PDF (hand-built, one page per chapter, Helvetica)
function pdf() {
  const pages = ['Anatomy Atlas: Upper Limb', 'Plate 1 · Humerus', 'Plate 2 · Radius and ulna', 'Plate 3 · Bones of the hand'];
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2; // reserved below
  for (const [i, title] of pages.entries()) {
    const body = `BT /F1 26 Tf 72 720 Td (${title}) Tj ET BT /F1 12 Tf 72 690 Td (MedNotes sample PDF - page ${i + 1} of ${pages.length}) Tj ET 0.2 0.45 0.7 RG 4 w 300 300 m 300 620 l S 300 300 m 260 140 l S 300 300 m 340 140 l S`;
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let s = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const off = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  write('anatomy-atlas-upper-limb.pdf', Buffer.from(s, 'latin1'));
}

// ---- DOCX (minimal WordprocessingML)
async function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const p = (t, { b = false, size = 22, color = '1F2937' } = {}) => `<w:p><w:r><w:rPr>${b ? '<w:b/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const row = (cells, head) => `<w:tr>${cells.map((c) => `<w:tc><w:p><w:r>${head ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
  const table = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${row(['Mediator', 'Source', 'Effect'], true)}${row(['Histamine', 'Mast cells', 'Vasodilation'])}${row(['Prostaglandin E2', 'Leukocytes', 'Fever, pain'])}${row(['Bradykinin', 'Plasma', 'Pain, permeability'])}</w:tbl>`;
  const body = [p('Pathology Notes', { b: true, size: 40 }), p('Vol. 1 · Cell Injury & Inflammation', { color: '64748B' }),
    p('1.1 Reversible cell injury', { b: true, size: 26, color: '2B579A' }),
    p('Cellular swelling and fatty change are the hallmarks of reversible injury. If the stimulus is removed, the cell recovers.'),
    p('1.2 Chemical mediators', { b: true, size: 26, color: '2B579A' }), table,
    p('Sample document for the MedNotes reader.', { color: '64748B' })].join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  write('pathology-notes-vol-1.docx', await zip.generateAsync({ type: 'nodebuffer' }));
}

// ---- PPTX
async function pptx() {
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  const slide = (title, lines) => {
    const s = deck.addSlide();
    s.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: 'C4462A' } });
    s.addText(title, { x: 0.6, y: 0.5, w: 12, h: 1, fontSize: 36, bold: true, color: '1F2937' });
    s.addText(lines.map((t) => ({ text: t, options: { bullet: true } })), { x: 0.6, y: 1.8, w: 7.5, h: 4, fontSize: 20, color: '334155' });
  };
  slide('Microbiology: Gram-positive cocci', ['Lecture deck sample', 'MedNotes E-Library']);
  slide('Staphylococci', ['Form grape-like clusters', 'Catalase positive', 'S. aureus is coagulase positive']);
  slide('Streptococci', ['Form chains', 'Catalase negative', 'Classified by hemolysis: alpha, beta, gamma']);
  write('microbiology-slides.pptx', Buffer.from(await deck.write({ outputType: 'nodebuffer' })));
}

// ---- XLSX
function xlsx() {
  const wb = XLSX.utils.book_new();
  const rows = [['Test', 'Normal range', 'Unit'], ['Sodium', '135–145', 'mmol/L'], ['Potassium', '3.5–5.0', 'mmol/L'], ['Hemoglobin', '12–16', 'g/dL'],
    ['WBC', '4.5–11', '×10⁹/L'], ['Glucose (fasting)', '70–100', 'mg/dL'], ['Creatinine', '0.6–1.2', 'mg/dL'], ['Platelets', '150–400', '×10⁹/L'], ['BUN', '7–20', 'mg/dL']];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Chemistry');
  write('lab-values-cheat-sheet.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ---- MP4 (needs ffmpeg on PATH)
function video() {
  const file = join(out, 'ecg-interpretation-lecture.mp4');
  try {
    const font = 'C\\:/Windows/Fonts/arial.ttf';
    const text = (t, y, size) => `drawtext=fontfile='${font}':text='${t}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x0B1220:s=1280x720:d=20',
      '-f', 'lavfi', '-i', 'sine=frequency=880:beep_factor=4:duration=20',
      '-vf', [text('ECG Interpretation Lecture', 260, 56), text('MedNotes sample video', 340, 32), text('%{eif\\:t\\:d}s', 420, 28)].join(','),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    console.log('wrote ecg-interpretation-lecture.mp4');
  } catch (e) {
    console.warn('ffmpeg not available; skipping video sample', existsSync(file) ? '(kept existing file)' : '', e.message.split('\n')[0]);
  }
}

await epub(); pdf(); await docx(); await pptx(); xlsx(); video();
