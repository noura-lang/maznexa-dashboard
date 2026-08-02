import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import ExcelJS from 'exceljs'
import { format } from 'date-fns'

// Single-element export (PDF / Excel / Google Sheets) for any chart or table
// wrapped in MaximizableChartCard. Replaces the old exportPdf.js, which only
// ever exported the whole Weekly Report tab as one multi-page document —
// that whole-tab feature is gone (see TopBar.jsx); this is per-element only.

// A4 portrait, in pt — same page geometry the old whole-tab export used, but
// here every export is exactly one page (one chart/table, never split).
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 30
const CONTENT_W = PAGE_W - MARGIN * 2
const HEADER_H = 70
const FOOTER_H = 20

// Bar fills switch to `fill="url(#wr-bar-grad-XXXXXX)"` in Dark Mode (see
// barFill()/BarDepthDefsRoot in WeeklyReport.jsx) — a gradient defined in a
// detached <svg> elsewhere in the DOM, referenced cross-SVG. html2canvas
// can't reliably resolve that, so the fill resolves to nothing ("bars
// invisible, labels fine"). Ported verbatim from the old exportPdf.js.
const GRADIENT_FILL_RE = /^url\(#wr-bar-grad-([0-9a-fA-F]{6})\)$/

function forceSolidBarFills(root) {
  const restores = []
  root.querySelectorAll('[fill]').forEach(el => {
    const current = el.getAttribute('fill')
    const match = current && current.match(GRADIENT_FILL_RE)
    if (!match) return
    restores.push({ el, original: current })
    el.setAttribute('fill', `#${match[1]}`)
  })
  return () => restores.forEach(({ el, original }) => el.setAttribute('fill', original))
}

// Tables that cap their height for the compact (non-maximized) view do it via
// an inline `style={{ maxHeight: h }}` (see MaximizableChartCard usage across
// the tabs), not a Tailwind class — deliberately, so this can find and lift
// that cap generically for the capture instead of scrolled-off rows being
// silently cut out of the exported image.
function neutralizeScrollCaps(root) {
  const restores = []
  const candidates = root.style.maxHeight ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*')
  candidates.forEach(el => {
    if (el.style && el.style.maxHeight && el.style.maxHeight !== 'none') {
      restores.push({ el, maxHeight: el.style.maxHeight, overflow: el.style.overflow })
      el.style.maxHeight = 'none'
      el.style.overflow = 'visible'
    }
  })
  return () => restores.forEach(({ el, maxHeight, overflow }) => {
    el.style.maxHeight = maxHeight
    el.style.overflow = overflow
  })
}

// jsPDF's own `pdf.save()` builds a detached <a> and dispatches a synthetic
// MouseEvent at it rather than calling the DOM `.click()` method — that
// silently does nothing in some browser/automation contexts (no error, no
// download). Downloading the PDF ourselves via the same appended-anchor +
// native `.click()` pattern `exportRowsAsExcel` already uses below sidesteps
// it entirely.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function fetchAsDataUrl(url) {
  return fetch(url)
    .then(res => { if (!res.ok) throw new Error('logo fetch failed'); return res.blob() })
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    }))
}

// public/logo.png is a 13112x1907 source asset (kept large for other uses)
// — jsPDF's addImage embeds the source pixel data as-is regardless of the
// on-page display size passed to it, so handing it the raw file bloats every
// exported PDF by ~25MB for a logo that only ever renders at 90x23pt. Redraw
// it onto a small canvas at a print-sharp-but-sane pixel size first.
function fetchLogoDataUrl(url, displayW, displayH) {
  return fetchAsDataUrl(url).then(dataUrl => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = 3
      const canvas = document.createElement('canvas')
      canvas.width = displayW * scale
      canvas.height = displayH * scale
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  }))
}

// Safe-ish filenames/sheet titles — spaces/slashes/etc collapse to hyphens,
// Sheets tab names are capped at 100 chars.
export function filenameSafe(title) {
  return (title || 'Export').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function sheetTabName(title) {
  return (title || 'Sheet1').replace(/[[\]*?/\\:]/g, ' ').slice(0, 95) || 'Sheet1'
}
export function todayStamp() {
  return format(new Date(), 'yyyy-MM-dd')
}

// Captures one DOM node as a single-page PDF. Flattens gradient bar fills and
// lifts any inline max-height scroll caps within the node so a scrolled
// table exports in full, not just its visible rows. Captures whatever theme
// (light/dark) is currently active — an earlier version forced light mode by
// toggling the `.dark` class on <html> first, but on pages with many heavy
// chart cards that toggle triggers a page-wide style recalculation that
// contends with html2canvas's own cloning and can hang for 30-60+ seconds
// (confirmed via isolated timing tests); capturing the live theme as-is
// keeps this fast (~8s) with no visual downside worth the risk.
export async function exportElementAsPdf(el, title) {
  if (!el) throw new Error('Nothing to export')

  const restoreBarFills = forceSolidBarFills(el)
  const restoreScrollCaps = neutralizeScrollCaps(el)
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await new Promise(resolve => setTimeout(resolve, 300))

  let canvas
  try {
    canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      // `.card` (every card in this app) uses Tailwind's backdrop-blur-sm.
      // html2canvas doesn't support backdrop-filter and can take upwards of
      // a minute (or hang) trying to process a page with many blurred cards
      // — confirmed against this exact app. `onclone` runs against html2canvas's
      // own detached clone, so stripping it here never touches the live page.
      onclone: clonedDoc => {
        clonedDoc.querySelectorAll('*').forEach(node => {
          node.style.backdropFilter = 'none'
          node.style.webkitBackdropFilter = 'none'
        })
      },
    })
  } finally {
    restoreScrollCaps()
    restoreBarFills()
  }

  const availH = PAGE_H - HEADER_H - FOOTER_H - MARGIN * 2
  const naturalH = (canvas.height * CONTENT_W) / canvas.width
  const w = naturalH <= availH ? CONTENT_W : CONTENT_W * (availH / naturalH)
  const h = Math.min(naturalH, availH)
  const x = MARGIN + (CONTENT_W - w) / 2

  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' })
  const logoDataUrl = await fetchLogoDataUrl('/logo.png', 90, 23).catch(() => null)

  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, 'PNG', MARGIN, 16, 90, 23)
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.setTextColor(104, 88, 162)
    pdf.text('MAZ', MARGIN, 32)
    pdf.setTextColor(140, 143, 254)
    pdf.text('|NEXA', MARGIN + pdf.getTextWidth('MAZ'), 32)
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(26, 14, 61)
  pdf.text(title, PAGE_W - MARGIN, 30, { align: 'right', maxWidth: 320 })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(120, 120, 120)
  pdf.text(`Exported ${format(new Date(), 'MMM d, yyyy HH:mm')}`, PAGE_W - MARGIN, 42, { align: 'right' })
  pdf.setDrawColor(220, 220, 220)
  pdf.line(MARGIN, HEADER_H - 12, PAGE_W - MARGIN, HEADER_H - 12)

  // JPEG, not PNG — html2canvas output for a gradient-heavy chart (this
  // app's dark-mode bar "depth" gradients, even after forceSolidBarFills
  // flattens the ones it can find) compresses very poorly as lossless PNG.
  // Confirmed against this exact codebase: the old whole-tab exportPdf.js
  // used PNG at the same scale:2 and produced 150MB+ PDFs for a handful of
  // charts. JPEG at 0.85 quality is visually indistinguishable for a chart
  // screenshot and orders of magnitude smaller.
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', x, HEADER_H, w, h)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(150, 150, 150)
  pdf.text('Maznexa Operations Dashboard', PAGE_W / 2, PAGE_H - 14, { align: 'center' })

  downloadBlob(pdf.output('blob'), `Maznexa-${filenameSafe(title)}-${todayStamp()}.pdf`)
}

function rowsToAoa(rows, columns) {
  return [
    columns.map(c => c.label),
    ...rows.map(r => columns.map(c => (c.format ? c.format(r[c.key]) : r[c.key] ?? ''))),
  ]
}

// One-sheet .xlsx of this element's own data (not a DOM screenshot) — full
// precision, not the rounded/short labels a chart might show on-screen.
export async function exportRowsAsExcel(rows, columns, title) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetTabName(title))
  const aoa = rowsToAoa(rows, columns)
  aoa.forEach(row => sheet.addRow(row))
  sheet.getRow(1).font = { bold: true }
  sheet.columns.forEach(col => { col.width = 18 })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Maznexa-${filenameSafe(title)}-${todayStamp()}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Creates a brand-new spreadsheet in the signed-in user's own Google Drive
// (via the Sheets API's spreadsheets.create — the app's existing
// `spreadsheets` OAuth scope is sufficient for this, no drive/drive.file
// scope needed) and writes this element's data into it. Same
// Authorization-header fetch pattern as amSheetApi.js/costSheetApi.js.
export async function exportRowsToGoogleSheet(accessToken, rows, columns, title) {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title: `Maznexa - ${title} - ${todayStamp()}` },
      sheets: [{ properties: { title: sheetTabName(title) } }],
    }),
  })
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Failed to create spreadsheet: HTTP ${createRes.status}`)
  }
  const created = await createRes.json()
  const { spreadsheetId, spreadsheetUrl } = created

  const values = rowsToAoa(rows, columns)
  const range = encodeURIComponent(`${sheetTabName(title)}!A1`)
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  )
  if (!writeRes.ok) {
    const err = await writeRes.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Failed to write data: HTTP ${writeRes.status}`)
  }

  return spreadsheetUrl
}
