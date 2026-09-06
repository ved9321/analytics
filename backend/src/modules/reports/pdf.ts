// A small vector PDF writer: text, rules, filled rectangles, polylines,
// tables, bar charts and line charts, across multiple pages.
//
// Why hand-rolled rather than a library: puppeteer pulls a ~300MB Chromium
// download, which breaks free-tier deploy size limits, and pdfkit adds a
// dependency for what — once you need charts as vectors anyway — is a few
// hundred lines of PDF content-stream operators.
//
// Produces PDF 1.4 with WinAnsi-encoded Helvetica, so Latin-1 accented
// characters in campaign names render properly. Characters outside Latin-1
// (CJK, emoji) become '?'.

const PAGE_WIDTH = 595; // A4 at 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = 60;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const INK: Rgb = { r: 0.08, g: 0.1, b: 0.14 };
export const MUTED: Rgb = { r: 0.45, g: 0.48, b: 0.55 };
export const RULE: Rgb = { r: 0.85, g: 0.87, b: 0.9 };
export const ACCENT: Rgb = { r: 0.72, g: 0.53, b: 0.13 };
export const POSITIVE: Rgb = { r: 0.18, g: 0.6, b: 0.42 };
export const NEGATIVE: Rgb = { r: 0.78, g: 0.28, b: 0.32 };
export const SERIES: Rgb[] = [
  ACCENT,
  { r: 0.2, g: 0.45, b: 0.72 },
  POSITIVE,
  { r: 0.55, g: 0.35, b: 0.65 },
];

function escapePdfText(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (char === '\\') out += '\\\\';
    else if (char === '(') out += '\\(';
    else if (char === ')') out += '\\)';
    else if (code >= 0x20 && code <= 0x7e) out += char;
    else if (code >= 0xa0 && code <= 0xff) out += '\\' + code.toString(8).padStart(3, '0');
    else if (code === 0x2019 || code === 0x2018) out += "'";
    else if (code === 0x201c || code === 0x201d) out += '"';
    else if (code === 0x2014 || code === 0x2013) out += '-';
    else out += '?';
  }
  return out;
}

/**
 * Helvetica advance widths (per 1000 units) for the printable ASCII range,
 * so text can be measured for centring, right-alignment and wrapping.
 * Without this, every column would have to be padded with spaces and
 * nothing would line up.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

export function textWidth(text: string, size: number, bold = false): number {
  let total = 0;
  for (const char of text) total += HELVETICA_WIDTHS[char] ?? 556;
  // Helvetica-Bold runs slightly wider; this approximation is close enough
  // for layout and avoids embedding a second width table.
  return (total / 1000) * size * (bold ? 1.06 : 1);
}

export function truncateToWidth(text: string, maxWidth: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && textWidth(result + '...', size, bold) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '...';
}

export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface TableColumn {
  label: string;
  /** Fraction of the content width, 0-1. Normalised if they don't sum to 1. */
  width: number;
  align?: 'left' | 'right';
}

export class VectorPdf {
  private pages: string[] = [];
  private current: string[] = [];
  private y = PAGE_HEIGHT - MARGIN;
  private pageNumber = 1;
  private footerText = '';
  /** Ops emitted by a heading that has no content under it yet, so a page
   *  break can carry it forward instead of stranding it. */
  private pendingHeading: { ops: string[]; consumedHeight: number } | null = null;

  constructor(private documentTitle = '') {}

  // --- low-level operators ------------------------------------------------

  private op(line: string) {
    this.current.push(line);
  }

  private setFill(color: Rgb) {
    this.op(`${color.r} ${color.g} ${color.b} rg`);
  }

  private setStroke(color: Rgb) {
    this.op(`${color.r} ${color.g} ${color.b} RG`);
  }

  /** Absolute-positioned text. Origin is bottom-left, as PDF expects. */
  drawText(text: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: Rgb; align?: 'left' | 'right' | 'center'; maxWidth?: number } = {}) {
    const size = opts.size ?? 9.5;
    const bold = opts.bold ?? false;
    let content = text;
    if (opts.maxWidth) content = truncateToWidth(content, opts.maxWidth, size, bold);

    let drawX = x;
    if (opts.align === 'right') drawX = x - textWidth(content, size, bold);
    else if (opts.align === 'center') drawX = x - textWidth(content, size, bold) / 2;

    this.setFill(opts.color ?? INK);
    this.op(`BT ${bold ? '/F2' : '/F1'} ${size} Tf ${drawX} ${y} Td (${escapePdfText(content)}) Tj ET`);
  }

  drawRect(x: number, y: number, width: number, height: number, color: Rgb) {
    this.setFill(color);
    this.op(`${x} ${y} ${width} ${height} re f`);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, color: Rgb, width = 0.6) {
    this.setStroke(color);
    this.op(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  drawPolyline(points: [number, number][], color: Rgb, width = 1.4) {
    if (points.length < 2) return;
    this.setStroke(color);
    const [first, ...rest] = points;
    this.op(`${width} w ${first[0]} ${first[1]} m ${rest.map(([x, y]) => `${x} ${y} l`).join(' ')} S`);
  }

  /** Filled area under a polyline, for area charts. */
  drawArea(points: [number, number][], baseY: number, color: Rgb, opacity = 0.15) {
    if (points.length < 2) return;
    this.op('q');
    this.op(`/GS${Math.round(opacity * 100)} gs`);
    this.setFill(color);
    const [first, ...rest] = points;
    this.op(
      `${first[0]} ${baseY} m ${first[0]} ${first[1]} l ${rest.map(([x, y]) => `${x} ${y} l`).join(' ')} ` +
        `${points[points.length - 1][0]} ${baseY} l f`
    );
    this.op('Q');
  }

  /** Filled circle. */
  drawCircle(cx: number, cy: number, r: number, color: Rgb, opacity = 1) {
    // Four Bézier arcs, the standard circle approximation — PDF has no
    // circle operator.
    const k = r * 0.5523;
    if (opacity < 1) {
      this.op('q');
      this.op(`/GS${Math.round(opacity * 100)} gs`);
    }
    this.setFill(color);
    this.op(
      `${cx - r} ${cy} m ` +
        `${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r} c ` +
        `${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy} c ` +
        `${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r} c ` +
        `${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy} c f`
    );
    if (opacity < 1) this.op('Q');
  }

  /** Ring segment, for donut charts. */
  drawArcSegment(cx: number, cy: number, outer: number, inner: number, startDeg: number, endDeg: number, color: Rgb) {
    const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
    // Flatten into short line segments: exact arc-to-Bézier for an annulus
    // is fiddly, and at print resolution 2-degree steps are indistinguishable
    // from a true curve.
    const step = 2;
    const points: [number, number][] = [];
    for (let angle = startDeg; angle <= endDeg; angle += step) {
      points.push([cx + outer * Math.cos(toRad(angle)), cy + outer * Math.sin(toRad(angle))]);
    }
    points.push([cx + outer * Math.cos(toRad(endDeg)), cy + outer * Math.sin(toRad(endDeg))]);
    for (let angle = endDeg; angle >= startDeg; angle -= step) {
      points.push([cx + inner * Math.cos(toRad(angle)), cy + inner * Math.sin(toRad(angle))]);
    }
    points.push([cx + inner * Math.cos(toRad(startDeg)), cy + inner * Math.sin(toRad(startDeg))]);

    this.setFill(color);
    const [first, ...rest] = points;
    this.op(`${first[0]} ${first[1]} m ${rest.map(([x, y]) => `${x} ${y} l`).join(' ')} f`);
  }

  /** Rounded rectangle, for chips and stacked segments. */
  drawRoundedRect(x: number, y: number, width: number, height: number, radius: number, color: Rgb) {
    const r = Math.min(radius, width / 2, height / 2);
    const k = r * 0.5523;
    this.setFill(color);
    this.op(
      `${x + r} ${y} m ${x + width - r} ${y} l ` +
        `${x + width - r + k} ${y} ${x + width} ${y + r - k} ${x + width} ${y + r} c ` +
        `${x + width} ${y + height - r} l ` +
        `${x + width} ${y + height - r + k} ${x + width - r + k} ${y + height} ${x + width - r} ${y + height} c ` +
        `${x + r} ${y + height} l ` +
        `${x + r - k} ${y + height} ${x} ${y + height - r + k} ${x} ${y + height - r} c ` +
        `${x} ${y + r} l ` +
        `${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} c f`
    );
  }

  // --- page flow ----------------------------------------------------------

  get cursorY() {
    return this.y;
  }

  setFooter(text: string) {
    this.footerText = text;
  }

  private finishPage() {
    if (this.footerText) {
      this.drawLine(MARGIN, BOTTOM_LIMIT - 12, PAGE_WIDTH - MARGIN, BOTTOM_LIMIT - 12, RULE, 0.5);
      this.drawText(this.footerText, MARGIN, BOTTOM_LIMIT - 26, { size: 7.5, color: MUTED });
      this.drawText(`Page ${this.pageNumber}`, PAGE_WIDTH - MARGIN, BOTTOM_LIMIT - 26, {
        size: 7.5,
        color: MUTED,
        align: 'right',
      });
    }
    this.pages.push(this.current.join('\n'));
    this.current = [];
  }

  newPage() {
    this.finishPage();
    this.pageNumber++;
    this.y = PAGE_HEIGHT - MARGIN;
    if (this.documentTitle) {
      this.drawText(this.documentTitle, MARGIN, this.y, { size: 8, color: MUTED });
      this.y -= 22;
    }
  }

  /** Starts a new page if less than `needed` vertical space remains. */
  ensureSpace(needed: number) {
    if (this.y - needed >= BOTTOM_LIMIT) {
      // Fits. Whatever draws next is this heading's content, so it is no
      // longer at risk of being stranded.
      this.pendingHeading = null;
      return;
    }

    const carried = this.pendingHeading;
    if (carried) {
      // Lift the heading off this page before breaking.
      this.current.splice(this.current.length - carried.ops.length, carried.ops.length);
      this.y += carried.consumedHeight;
    }

    this.newPage();

    if (carried) {
      // Redraw at the top of the new page. The ops carry absolute
      // coordinates, so they are re-emitted rather than replayed.
      const startY = this.y;
      this.y -= 6;
      const text = carried.ops
        .map((op) => op.match(/\((.*)\) Tj/)?.[1])
        .find(Boolean);
      if (text) this.drawText(text, MARGIN, this.y, { size: 8.5, bold: true, color: MUTED });
      this.y -= 6;
      this.drawLine(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, RULE, 0.5);
      this.y -= 16;
    }
    // The caller draws immediately after this returns, so nothing is pending.
    this.pendingHeading = null;
  }



  // --- content blocks -----------------------------------------------------

  title(text: string, subtitle?: string) {
    this.ensureSpace(60);
    this.drawText(text, MARGIN, this.y, { size: 20, bold: true });
    this.y -= 20;
    if (subtitle) {
      this.drawText(subtitle, MARGIN, this.y, { size: 9.5, color: MUTED });
      this.y -= 14;
    }
    this.y -= 8;
    this.drawLine(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, RULE, 1);
    this.y -= 20;
  }

  /**
   * @param minFollowing Vertical space the block after this heading needs.
   *   Without it a heading can be drawn at the bottom of a page and its
   *   content pushed to the next one, which is how "SPEND AND CONVERSIONS
   *   BY DAY" ended up stranded above an empty half-page.
   */
  heading(text: string, minFollowing = 96) {
    this.ensureSpace(40 + minFollowing);
    const startIndex = this.current.length;
    const startY = this.y;

    this.y -= 6;
    this.drawText(text.toUpperCase(), MARGIN, this.y, { size: 8.5, bold: true, color: MUTED });
    this.y -= 6;
    this.drawLine(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, RULE, 0.5);
    this.y -= 16;

    // Remember what this heading drew. If the very next block does not fit
    // and forces a page break, the heading is lifted off this page and
    // redrawn at the top of the next — reserving a fixed amount of space is
    // guesswork, because a caller cannot know how tall its own chart is.
    this.pendingHeading = {
      ops: this.current.slice(startIndex),
      consumedHeight: startY - this.y,
    };
  }

  paragraph(text: string, opts: { color?: Rgb; size?: number } = {}) {
    const size = opts.size ?? 9.5;
    for (const line of wrapText(text, CONTENT_WIDTH, size)) {
      this.ensureSpace(size + 5);
      this.drawText(line, MARGIN, this.y, { size, color: opts.color });
      this.y -= size + 4;
    }
    this.y -= 6;
  }

  /** Row of KPI cards with value, label and optional change. */
  kpiRow(cards: { label: string; value: string; change?: number | null }[]) {
    if (cards.length === 0) return;
    const perRow = Math.min(cards.length, 4);
    const gap = 10;
    const cardWidth = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
    const cardHeight = 52;

    for (let i = 0; i < cards.length; i += perRow) {
      const slice = cards.slice(i, i + perRow);
      this.ensureSpace(cardHeight + 12);
      const top = this.y;

      slice.forEach((card, index) => {
        const x = MARGIN + index * (cardWidth + gap);
        this.drawRect(x, top - cardHeight, cardWidth, cardHeight, { r: 0.97, g: 0.975, b: 0.98 });
        this.drawLine(x, top - cardHeight, x, top, ACCENT, 1.5);
        this.drawText(card.label, x + 10, top - 16, { size: 7.5, color: MUTED, maxWidth: cardWidth - 20 });
        this.drawText(card.value, x + 10, top - 34, { size: 14, bold: true, maxWidth: cardWidth - 20 });
        if (card.change != null && Number.isFinite(card.change)) {
          const up = card.change >= 0;
          this.drawText(
            `${up ? '+' : ''}${card.change.toFixed(1)}% vs prior`,
            x + 10,
            top - 46,
            { size: 7, color: up ? POSITIVE : NEGATIVE }
          );
        }
      });

      this.y = top - cardHeight - 14;
    }
  }

  table(columns: TableColumn[], rows: string[][], opts: { totalsRow?: string[] } = {}) {
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || 1;
    const widths = columns.map((c) => (c.width / totalWidth) * CONTENT_WIDTH);
    const xs: number[] = [];
    let cursor = MARGIN;
    for (const width of widths) {
      xs.push(cursor);
      cursor += width;
    }

    const drawHeader = () => {
      this.ensureSpace(30);
      this.drawRect(MARGIN, this.y - 4, CONTENT_WIDTH, 18, { r: 0.96, g: 0.965, b: 0.975 });
      columns.forEach((column, i) => {
        const align = column.align ?? 'left';
        const x = align === 'right' ? xs[i] + widths[i] - 6 : xs[i] + 6;
        this.drawText(column.label, x, this.y + 2, {
          size: 7.5,
          bold: true,
          color: MUTED,
          align: align === 'right' ? 'right' : 'left',
          maxWidth: widths[i] - 12,
        });
      });
      this.y -= 20;
    };

    drawHeader();

    for (const row of rows) {
      if (this.y - 16 < BOTTOM_LIMIT) {
        this.newPage();
        drawHeader();
      }
      columns.forEach((column, i) => {
        const align = column.align ?? 'left';
        const x = align === 'right' ? xs[i] + widths[i] - 6 : xs[i] + 6;
        this.drawText(row[i] ?? '', x, this.y, {
          size: 8.5,
          align: align === 'right' ? 'right' : 'left',
          maxWidth: widths[i] - 12,
        });
      });
      this.y -= 5;
      this.drawLine(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, RULE, 0.4);
      this.y -= 11;
    }

    if (opts.totalsRow) {
      this.ensureSpace(22);
      columns.forEach((column, i) => {
        const align = column.align ?? 'left';
        const x = align === 'right' ? xs[i] + widths[i] - 6 : xs[i] + 6;
        this.drawText(opts.totalsRow![i] ?? '', x, this.y, {
          size: 8.5,
          bold: true,
          align: align === 'right' ? 'right' : 'left',
          maxWidth: widths[i] - 12,
        });
      });
      this.y -= 8;
      this.drawLine(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, INK, 0.8);
      this.y -= 14;
    }

    this.y -= 8;
  }

  /**
   * Line or area chart with axes, gridlines and a legend.
   *
   * Series whose magnitudes differ by more than ~20x get their own right
   * axis. Without this, plotting spend (thousands) against conversions
   * (dozens) renders conversions as a flat line along the bottom — the
   * chart technically correct and completely useless.
   */
  lineChart(params: {
    labels: string[];
    series: { name: string; values: number[] }[];
    height?: number;
    area?: boolean;
    valueFormatter?: (value: number) => string;
  }) {
    const height = params.height ?? 170;
    this.ensureSpace(height + 52);

    const format = params.valueFormatter ?? ((v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }));

    // Decide which series belong on a secondary axis.
    const magnitudes = params.series.map((s) => Math.max(...s.values.map((v) => Math.abs(v) || 0), 0));
    const largest = Math.max(...magnitudes, 0);
    const rightAxis = params.series.map((_, i) => largest > 0 && magnitudes[i] > 0 && largest / magnitudes[i] > 20);
    const hasRightAxis = rightAxis.some(Boolean);

    const plotLeft = MARGIN + 44;
    const plotRight = PAGE_WIDTH - MARGIN - (hasRightAxis ? 44 : 8);
    const plotWidth = plotRight - plotLeft;
    const top = this.y;
    const bottom = top - height;

    function scaleFor(useRight: boolean) {
      const values = params.series
        .filter((_, i) => rightAxis[i] === useRight)
        .flatMap((s) => s.values)
        .filter((v) => Number.isFinite(v));
      if (values.length === 0) return { min: 0, max: 1, span: 1 };
      const max = Math.max(...values, 0);
      const min = Math.min(...values, 0);
      return { min, max, span: max - min || 1 };
    }

    const leftScale = scaleFor(false);
    const rightScale = hasRightAxis ? scaleFor(true) : null;

    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = bottom + (height * i) / gridCount;
      this.drawLine(plotLeft, y, plotRight, y, RULE, 0.4);
      this.drawText(format(leftScale.min + (leftScale.span * i) / gridCount), plotLeft - 6, y - 2.5, {
        size: 6.5,
        color: MUTED,
        align: 'right',
      });
      if (rightScale) {
        this.drawText(format(rightScale.min + (rightScale.span * i) / gridCount), plotRight + 6, y - 2.5, {
          size: 6.5,
          color: MUTED,
        });
      }
    }

    const pointCount = params.labels.length;
    const xAt = (index: number) =>
      pointCount === 1 ? plotLeft + plotWidth / 2 : plotLeft + (plotWidth * index) / (pointCount - 1);

    params.series.forEach((series, seriesIndex) => {
      const color = SERIES[seriesIndex % SERIES.length];
      const scale = rightAxis[seriesIndex] && rightScale ? rightScale : leftScale;
      const points = series.values.map((value, index) => {
        const safe = Number.isFinite(value) ? value : 0;
        return [xAt(index), bottom + ((safe - scale.min) / scale.span) * height] as [number, number];
      });
      if (params.area && seriesIndex === 0) this.drawArea(points, bottom, color, 0.12);
      this.drawPolyline(points, color, 1.4);
    });

    const step = Math.max(1, Math.ceil(pointCount / 8));
    for (let i = 0; i < pointCount; i += step) {
      this.drawText(params.labels[i], xAt(i), bottom - 11, { size: 6.5, color: MUTED, align: 'center' });
    }
    this.drawLine(plotLeft, bottom, plotRight, bottom, MUTED, 0.6);

    this.y = bottom - 24;

    // Legend, marking which axis each series is read against.
    let legendX = plotLeft;
    params.series.forEach((series, index) => {
      const color = SERIES[index % SERIES.length];
      const label = hasRightAxis ? `${series.name} (${rightAxis[index] ? 'right' : 'left'})` : series.name;
      this.drawRect(legendX, this.y, 8, 3, color);
      this.drawText(label, legendX + 12, this.y - 1, { size: 7.5, color: MUTED });
      legendX += 12 + textWidth(label, 7.5) + 18;
    });
    this.y -= 22;
  }

  /** Horizontal bar chart — better than vertical for named categories. */
  barChart(params: { rows: { label: string; value: number }[]; valueFormatter?: (value: number) => string; height?: number }) {
    const rows = params.rows.filter((r) => Number.isFinite(r.value));
    if (rows.length === 0) return;

    const barHeight = 13;
    const gap = 7;
    const needed = rows.length * (barHeight + gap) + 16;
    this.ensureSpace(Math.min(needed, params.height ?? needed));

    const format = params.valueFormatter ?? ((v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
    const labelWidth = 130;
    const valueWidth = 70;
    const trackLeft = MARGIN + labelWidth;
    const trackWidth = CONTENT_WIDTH - labelWidth - valueWidth;
    const maxValue = Math.max(...rows.map((r) => r.value), 0) || 1;

    for (const row of rows) {
      if (this.y - (barHeight + gap) < BOTTOM_LIMIT) this.newPage();
      const width = Math.max((row.value / maxValue) * trackWidth, 1);
      this.drawText(row.label, MARGIN, this.y, { size: 8.5, maxWidth: labelWidth - 8 });
      this.drawRect(trackLeft, this.y - 3, trackWidth, barHeight - 4, { r: 0.95, g: 0.955, b: 0.965 });
      this.drawRect(trackLeft, this.y - 3, width, barHeight - 4, ACCENT);
      this.drawText(format(row.value), PAGE_WIDTH - MARGIN, this.y, { size: 8.5, align: 'right' });
      this.y -= barHeight + gap - 4;
    }
    this.y -= 12;
  }

  /**
   * Donut with the total in the middle and a legend beneath. The same
   * composition view the dashboard shows, so a report and the screen agree.
   */
  donutChart(params: {
    slices: { label: string; value: number }[];
    totalLabel?: string;
    valueFormatter?: (value: number) => string;
    size?: number;
  }) {
    const slices = params.slices.filter((slice) => slice.value > 0);
    if (slices.length === 0) return;

    const size = params.size ?? 130;
    const legendHeight = slices.length * 14 + 8;
    this.ensureSpace(size + legendHeight + 12);

    const format = params.valueFormatter ?? ((value: number) => value.toLocaleString('en-US'));
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    const cx = MARGIN + size / 2;
    const cy = this.y - size / 2;
    const outer = size / 2;
    const inner = outer * 0.62;

    let angle = 0;
    slices.forEach((slice, index) => {
      const sweep = (slice.value / total) * 360;
      this.drawArcSegment(cx, cy, outer, inner, angle, angle + sweep, SERIES[index % SERIES.length]);
      angle += sweep;
    });

    this.drawText(format(total), cx, cy - 2, { size: 13, bold: true, align: 'center' });
    this.drawText(params.totalLabel ?? 'TOTAL', cx, cy - 14, { size: 6.5, color: MUTED, align: 'center' });

    // Legend to the right of the ring, so the block stays compact.
    let legendY = this.y - 14;
    const legendX = MARGIN + size + 22;
    slices.forEach((slice, index) => {
      this.drawRect(legendX, legendY - 1, 7, 7, SERIES[index % SERIES.length]);
      this.drawText(slice.label, legendX + 12, legendY, { size: 8.5, maxWidth: 150 });
      this.drawText(format(slice.value), PAGE_WIDTH - MARGIN, legendY, { size: 8.5, align: 'right' });
      legendY -= 14;
    });

    this.y = Math.min(cy - outer, legendY) - 14;
  }

  /** Stacked horizontal bar — share of total in a single strip. */
  shareBar(params: { segments: { label: string; value: number }[]; valueFormatter?: (value: number) => string }) {
    const segments = params.segments.filter((segment) => segment.value > 0);
    if (segments.length === 0) return;
    this.ensureSpace(46 + segments.length * 12);

    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    const format = params.valueFormatter ?? ((value: number) => value.toLocaleString('en-US'));
    const height = 12;
    let x = MARGIN;

    segments.forEach((segment, index) => {
      const width = (segment.value / total) * CONTENT_WIDTH;
      this.drawRect(x, this.y - height, width, height, SERIES[index % SERIES.length]);
      x += width;
    });
    this.y -= height + 12;

    segments.forEach((segment, index) => {
      this.drawRect(MARGIN, this.y - 1, 7, 7, SERIES[index % SERIES.length]);
      this.drawText(segment.label, MARGIN + 12, this.y, { size: 8.5, maxWidth: 200 });
      // If the formatted value is already a percentage, the computed share
      // is the same number twice.
      const formatted = format(segment.value);
      const share = `${((segment.value / total) * 100).toFixed(1)}%`;
      this.drawText(formatted.trim().endsWith('%') ? formatted : `${formatted}   ${share}`, PAGE_WIDTH - MARGIN, this.y, {
        size: 8.5,
        align: 'right',
      });
      this.y -= 12;
    });
    this.y -= 8;
  }

  /** Grouped or stacked column chart, for categorical comparison. */
  columnChart(params: {
    categories: string[];
    series: { name: string; values: number[] }[];
    stacked?: boolean;
    height?: number;
    valueFormatter?: (value: number) => string;
  }) {
    const height = params.height ?? 150;
    this.ensureSpace(height + 44);

    const format = params.valueFormatter ?? ((value: number) => (Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)));
    const plotLeft = MARGIN + 44;
    const plotRight = PAGE_WIDTH - MARGIN - 6;
    const top = this.y;
    const bottom = top - height;

    const totals = params.stacked
      ? params.categories.map((_, i) => params.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
      : params.series.flatMap((s) => s.values);
    const max = Math.max(...totals, 0) || 1;

    for (let i = 0; i <= 4; i++) {
      const y = bottom + (height * i) / 4;
      this.drawLine(plotLeft, y, plotRight, y, RULE, 0.4);
      this.drawText(format((max * i) / 4), plotLeft - 6, y - 2.5, { size: 6.5, color: MUTED, align: 'right' });
    }

    const slotWidth = (plotRight - plotLeft) / Math.max(params.categories.length, 1);
    const barWidth = params.stacked ? slotWidth * 0.55 : (slotWidth * 0.62) / params.series.length;

    params.categories.forEach((category, categoryIndex) => {
      const slotX = plotLeft + categoryIndex * slotWidth;
      let stackBase = bottom;

      params.series.forEach((series, seriesIndex) => {
        const value = series.values[categoryIndex] ?? 0;
        const barHeight = (value / max) * height;
        const x = params.stacked
          ? slotX + (slotWidth - barWidth) / 2
          : slotX + slotWidth * 0.19 + seriesIndex * barWidth;
        this.drawRect(x, params.stacked ? stackBase : bottom, barWidth - 1, barHeight, SERIES[seriesIndex % SERIES.length]);
        if (params.stacked) stackBase += barHeight;
      });

      // Thin the labels rather than overlapping them.
      const step = Math.max(1, Math.ceil(params.categories.length / 10));
      if (categoryIndex % step === 0) {
        this.drawText(category, slotX + slotWidth / 2, bottom - 11, {
          size: 6.5,
          color: MUTED,
          align: 'center',
          maxWidth: slotWidth * step,
        });
      }
    });

    this.drawLine(plotLeft, bottom, plotRight, bottom, MUTED, 0.6);
    this.y = bottom - 22;

    let legendX = plotLeft;
    params.series.forEach((series, index) => {
      this.drawRect(legendX, this.y, 8, 3, SERIES[index % SERIES.length]);
      this.drawText(series.name, legendX + 12, this.y - 1, { size: 7.5, color: MUTED });
      legendX += 12 + textWidth(series.name, 7.5) + 18;
    });
    this.y -= 20;
  }

  /** Sparkline-sized inline trend, for a table cell or a KPI card. */
  sparkline(x: number, y: number, width: number, height: number, values: number[], color: Rgb = ACCENT) {
    if (values.length < 2) return;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const points = values.map(
      (value, index) => [x + (index / (values.length - 1)) * width, y + ((value - min) / span) * height] as [number, number]
    );
    this.drawPolyline(points, color, 1);
  }

  /**
   * A two-column section: explanatory prose on one side, a visual on the
   * other, alternating sides down the document.
   *
   * A report that is only charts makes the reader do the interpretation; one
   * that is only prose makes them take it on trust. Pairing them is what the
   * reference data reports do, and it is why they read as arguments rather
   * than dumps.
   */
  splitSection(params: {
    title: string;
    body: string[];
    /** Draws into the given box. Coordinates are absolute. */
    draw: (box: { x: number; y: number; width: number; height: number }) => void;
    visualOn?: 'left' | 'right';
    height?: number;
    /** Pass false to omit the section mark. */
    icon?: false;
  }) {
    const height = params.height ?? 165;
    this.ensureSpace(height + 34);

    const columnGap = 26;
    const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
    const visualOnLeft = params.visualOn === 'left';
    const textX = visualOnLeft ? MARGIN + columnWidth + columnGap : MARGIN;
    const visualX = visualOnLeft ? MARGIN : MARGIN + columnWidth + columnGap;
    const top = this.y;

    let textY = top;
    if (params.icon !== false) {
      // A drawn mark rather than a glyph: the symbols these sections want
      // live outside Latin-1, and WinAnsi-encoded Helvetica turns anything
      // outside that range into a question mark.
      this.drawCircle(textX + 6, textY - 5, 6, ACCENT, 0.15);
      this.drawCircle(textX + 6, textY - 5, 2.5, ACCENT);
      textY -= 22;
    }
    this.drawText(params.title, textX, textY, { size: 12.5, bold: true, maxWidth: columnWidth });
    textY -= 18;

    for (const paragraph of params.body) {
      for (const line of wrapText(paragraph, columnWidth, 8.5)) {
        this.drawText(line, textX, textY, { size: 8.5, color: MUTED });
        textY -= 12;
      }
      textY -= 6;
    }

    params.draw({ x: visualX, y: top - height, width: columnWidth, height });

    // Both columns are absolutely placed, so the cursor drops past whichever
    // ran longer.
    this.y = Math.min(textY, top - height) - 20;
  }

  /** Line chart drawn into an explicit box, for use inside splitSection. */
  lineChartIn(box: { x: number; y: number; width: number; height: number }, params: {
    labels: string[];
    series: { name: string; values: number[] }[];
    valueFormatter?: (value: number) => string;
  }) {
    const format = params.valueFormatter ?? ((value: number) => (Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)));
    const plotLeft = box.x + 32;
    const plotRight = box.x + box.width;
    const bottom = box.y + 20;
    const height = box.height - 34;

    const values = params.series.flatMap((series) => series.values).filter(Number.isFinite);
    const max = Math.max(...values, 0) || 1;
    const min = Math.min(...values, 0);
    const span = max - min || 1;

    for (let i = 0; i <= 3; i++) {
      const y = bottom + (height * i) / 3;
      this.drawLine(plotLeft, y, plotRight, y, RULE, 0.4);
      this.drawText(format(min + (span * i) / 3), plotLeft - 5, y - 2.5, { size: 6, color: MUTED, align: 'right' });
    }

    const count = params.labels.length;
    const xAt = (index: number) => (count <= 1 ? plotLeft : plotLeft + ((plotRight - plotLeft) * index) / (count - 1));

    params.series.forEach((series, index) => {
      const points = series.values.map(
        (value, i) => [xAt(i), bottom + ((value - min) / span) * height] as [number, number]
      );
      this.drawPolyline(points, SERIES[index % SERIES.length], 1.4);
      // The final value labelled on the line itself, so the reader does not
      // have to trace back to an axis.
      const last = points[points.length - 1];
      if (last) {
        this.drawText(format(series.values[series.values.length - 1]), last[0], last[1] + 5, {
          size: 7.5,
          bold: true,
          color: SERIES[index % SERIES.length],
          align: 'right',
        });
      }
    });

    const step = Math.max(1, Math.ceil(count / 5));
    for (let i = 0; i < count; i += step) {
      this.drawText(params.labels[i], xAt(i), bottom - 10, { size: 6, color: MUTED, align: 'center' });
    }
    this.drawLine(plotLeft, bottom, plotRight, bottom, MUTED, 0.5);
  }

  // --- output -------------------------------------------------------------

  build(): Buffer {
    this.finishPage();

    const objects: string[] = [];
    const pageCount = this.pages.length;

    // 1 catalog, 2 pages tree, then per page: page dict + content stream,
    // then two fonts and the ExtGState set used for area-chart opacity.
    const pageObjectIds: number[] = [];
    let nextId = 3;
    for (let i = 0; i < pageCount; i++) {
      pageObjectIds.push(nextId);
      nextId += 2;
    }
    const fontRegularId = nextId++;
    const fontBoldId = nextId++;
    const gsId = nextId++;

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`);

    this.pages.forEach((content, index) => {
      const contentId = pageObjectIds[index] + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> ` +
          `/ExtGState ${gsId} 0 R >> /Contents ${contentId} 0 R >>`
      );
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    // Pre-declared alpha states, referenced as /GS12 etc. by drawArea.
    const alphaStates = [10, 12, 15, 20, 25, 100]
      .map((value) => `/GS${value} << /ca ${value / 100} >>`)
      .join(' ');
    objects.push(`<< ${alphaStates} >>`);

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
  }
}
