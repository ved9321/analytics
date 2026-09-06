'use client';
import React from 'react';

// A small markdown renderer, written rather than installed on purpose:
// react-markdown plus remark-gfm is a meaningful dependency chain for what
// analytics answers actually use, and this way the output is styled to the
// app's tokens rather than fighting a stylesheet.
//
// Supports: headings, bold, italic, inline code, fenced code blocks,
// unordered/ordered lists, GFM tables, blockquotes, horizontal rules and
// links. Anything else renders as plain text, which is the right failure
// mode for model output.

type Inline = { type: 'text' | 'bold' | 'italic' | 'code' | 'link'; value: string; href?: string };

/**
 * Tokenises inline markup. Ordered so that code spans win over emphasis —
 * otherwise `a_b_c` inside backticks would get mangled into italics.
 */
function parseInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    } else if (raw.startsWith('[')) {
      const linkMatch = raw.match(/\[([^\]]+)\]\(([^)]+)\)/);
      tokens.push({ type: 'link', value: linkMatch?.[1] ?? raw, href: linkMatch?.[2] });
    } else {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
  return tokens;
}

function InlineRun({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        switch (token.type) {
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-paper">
                {token.value}
              </strong>
            );
          case 'italic':
            return (
              <em key={i} className="italic">
                {token.value}
              </em>
            );
          case 'code':
            return (
              <code key={i} className="bg-ink-800 px-1 py-0.5 font-mono text-subhead text-signal">
                {token.value}
              </code>
            );
          case 'link':
            return (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noreferrer"
                className="text-signal underline decoration-signal/40 hover:decoration-signal"
              >
                {token.value}
              </a>
            );
          default:
            return <React.Fragment key={i}>{token.value}</React.Fragment>;
        }
      })}
    </>
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** True when a line looks like the `---|:--:|---` separator under a header. */
function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; language: string; lines: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; header: string[]; align: ('left' | 'right' | 'center')[]; rows: string[][] };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ kind: 'code', language, lines: body });
      continue;
    }

    // Table: a header row followed by a divider
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]).map((cell) =>
        cell.endsWith(':') && cell.startsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left'
      ) as ('left' | 'right' | 'center')[];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', header, align, rows });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\S]*$/.test(line) && line.replace(/[\s*_-]/g, '') === '') {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>\s?)/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      paragraph.push(lines[i]);
      i++;
    }
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    else i++;
  }

  return blocks;
}

export default function Markdown({ children, className = '' }: { children: string; className?: string }) {
  const blocks = parseBlocks(children ?? '');

  return (
    <div className={`text-body leading-relaxed text-paper/90 ${className}`}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'h':
            return (
              <div
                key={index}
                className={`mb-1.5 mt-4 font-medium text-paper first:mt-0 ${
                  block.level <= 2 ? 'text-callout' : 'text-body'
                }`}
              >
                <InlineRun text={block.text} />
              </div>
            );
          case 'p':
            return (
              <p key={index} className="mb-2.5 last:mb-0">
                <InlineRun text={block.text} />
              </p>
            );
          case 'ul':
            return (
              <ul key={index} className="mb-2.5 space-y-1 last:mb-0">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 bg-signal" />
                    <span className="min-w-0">
                      <InlineRun text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={index} className="mb-2.5 space-y-1 last:mb-0">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 font-mono text-caption text-muted">{i + 1}.</span>
                    <span className="min-w-0">
                      <InlineRun text={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <div key={index} className="mb-3 border border-line-soft bg-ink-900 last:mb-0">
                {block.language && (
                  <div className="border-b border-line-soft px-3 py-1 font-mono text-caption uppercase tracking-wide text-muted">
                    {block.language}
                  </div>
                )}
                <pre className="overflow-x-auto px-3 py-2 font-mono text-subhead leading-relaxed text-paper/90">
                  {block.lines.join('\n')}
                </pre>
              </div>
            );
          case 'quote':
            return (
              <blockquote key={index} className="mb-2.5 border-l-2 border-line pl-3 text-muted last:mb-0">
                <InlineRun text={block.text} />
              </blockquote>
            );
          case 'hr':
            return <hr key={index} className="my-3 border-line-soft" />;
          case 'table':
            return (
              <div key={index} className="mb-3 overflow-x-auto border border-line-soft last:mb-0">
                <table className="w-full text-left text-subhead">
                  <thead>
                    <tr className="border-b border-line-soft">
                      {block.header.map((cell, i) => (
                        <th
                          key={i}
                          className={`whitespace-nowrap px-3 py-1.5 font-normal text-muted ${
                            block.align[i] === 'right' ? 'text-right' : block.align[i] === 'center' ? 'text-center' : ''
                          }`}
                        >
                          <InlineRun text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i} className="border-b border-line-soft last:border-0">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className={`px-3 py-1.5 ${
                              block.align[j] === 'right'
                                ? 'text-right font-mono tabular-nums'
                                : block.align[j] === 'center'
                                  ? 'text-center'
                                  : ''
                            }`}
                          >
                            <InlineRun text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
