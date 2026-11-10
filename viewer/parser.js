/*
 * Research-note Markdown parser (no dependencies, browser + Node).
 *
 * Supported syntax (see CLAUDE.md):
 *   frontmatter (--- key: value ---), tag.<key>: Label | description
 *   # headings, paragraphs, **bold**, *em*, ~~del~~, `code`, ```fences```
 *   [text](url), <https://autolink>, - / 1. lists (nested), > quotes,
 *   > [!NOTE|TIP|IMPORTANT|WARNING|CAUTION] callouts, | tables |, ---
 *   citations [^id] + definitions "[^id]: text" (rendered as the reference list
 *   where the first definition appears), tags {{key}} / {{key:label}}
 */
(function (root) {
  'use strict';

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;

  const RE = {
    fence: /^\s*(`{3,}|~{3,})\s*([\w+-]*)/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    fndef: /^\[\^([\w-]+)\]:\s*(.*)$/,
    quote: /^\s*>/,
    item: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    tableRow: /^\s*\|/,
    tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
  };

  const CALLOUT = { note: 'メモ', tip: 'ヒント', important: '重要', warning: '注意', caution: '警告' };

  function isBlockStart(l, next) {
    return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.fndef.test(l) ||
      RE.quote.test(l) || RE.item.test(l) || (RE.tableRow.test(l) && next !== undefined && RE.tableSep.test(next));
  }

  function parseFrontmatter(src) {
    const meta = {};
    const tags = {};
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
    if (!m) return { meta, tags, body: src, offset: 0 };
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w.-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const [, k, v] = kv;
      if (k.startsWith('tag.')) {
        const [label, ...desc] = v.split('|');
        tags[k.slice(4)] = { label: label.trim(), desc: desc.join('|').trim() };
      } else meta[k] = v.trim();
    }
    return { meta, tags, body: src.slice(m[0].length) };
  }

  /* ---------- block level ---------- */

  function collectDefs(lines, ctx) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(RE.fndef);
      if (!m) continue;
      let text = m[2];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) text += ' ' + lines[++i].trim();
      if (ctx.refs.has(m[1])) ctx.warnings.push(`出典IDの重複: ${m[1]}`);
      else ctx.refs.set(m[1], { id: m[1], n: ctx.refs.size + 1, text, uses: 0 });
    }
  }

  function parseBlocks(lines, ctx) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (/^\s*$/.test(line)) { i++; continue; }

      if ((m = line.match(RE.fence))) {
        const fence = m[1], buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        out.push({ t: 'code', lang: m[2], text: buf.join('\n') });
        continue;
      }
      if ((m = line.match(RE.heading))) { out.push({ t: 'h', level: m[1].length, text: m[2] }); i++; continue; }
      if (RE.hr.test(line)) { out.push({ t: 'hr' }); i++; continue; }
      if (RE.fndef.test(line)) {
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) i++;
        if (!ctx.refsPlaced) { out.push({ t: 'refs' }); ctx.refsPlaced = true; }
        continue;
      }
      if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const split = (r) => r.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
          .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
        const head = split(line);
        const aligns = split(lines[i + 1]).map((c) =>
          c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(split(lines[i++]));
        out.push({ t: 'table', head, aligns, rows });
        continue;
      }
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        const cm = buf[0].match(/^\[!(\w+)\]\s*(.*)$/);
        if (cm) {
          buf.shift();
          out.push({ t: 'callout', kind: cm[1].toLowerCase(), title: cm[2], children: parseBlocks(buf, ctx) });
        } else out.push({ t: 'quote', children: parseBlocks(buf, ctx) });
        continue;
      }
      if ((m = line.match(RE.item))) {
        const base = m[1].length;
        const ordered = /\d/.test(m[2]);
        const start = ordered ? parseInt(m[2], 10) : 1;
        const items = [];
        while (i < lines.length) {
          if (/^\s*$/.test(lines[i])) {
            let j = i; while (j < lines.length && /^\s*$/.test(lines[j])) j++;
            const nm = j < lines.length && lines[j].match(RE.item);
            if (nm && nm[1].length === base && /\d/.test(nm[2]) === ordered) { i = j; continue; }
            break;
          }
          const lm = lines[i].match(RE.item);
          if (!lm || lm[1].length !== base || /\d/.test(lm[2]) !== ordered) break;
          const contentIndent = lm[1].length + lm[2].length + 1;
          const buf = [lm[3]];
          i++;
          while (i < lines.length) {
            const l = lines[i];
            if (/^\s*$/.test(l)) {
              let j = i + 1; while (j < lines.length && /^\s*$/.test(lines[j])) j++;
              if (j < lines.length && indentOf(lines[j]) >= contentIndent) { buf.push(''); i++; continue; }
              break;
            }
            const ind = indentOf(l);
            if (ind > base) { buf.push(l.replace(/^\s*/, ' '.repeat(Math.max(0, ind - contentIndent)))); i++; continue; }
            if (!isBlockStart(l, lines[i + 1])) { buf.push(l.trim()); i++; continue; }
            break;
          }
          items.push(parseBlocks(buf, ctx));
        }
        out.push({ t: 'list', ordered, start, items });
        continue;
      }
      const buf = [line.trim()];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i], lines[i + 1])) buf.push(lines[i++].trim());
      out.push({ t: 'p', text: buf.join('\n') });
    }
    return out;
  }

  /* ---------- inline ---------- */

  const safeHref = (u) => (/^\s*(javascript|data|vbscript):/i.test(u) ? '#' : u);
  const isExternal = (u) => /^https?:/i.test(u);

  function inline(src, ctx) {
    const stash = [];
    const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
    let s = src
      .replace(/ {2,}\n/g, '\u0001')
      .replace(/([^\x00-\x7F])\n(?=[^\x00-\x7F])/g, '$1')
      .replace(/\n/g, ' ');

    s = s.replace(/(`+)(.+?)\1/g, (_, __, code) => keep(`<code>${esc(code.trim())}</code>`));
    s = esc(s);

    s = s.replace(/\[\^([\w-]+)\]/g, (_, id) => keep(cite(id, ctx)));
    s = s.replace(/\{\{([\w-]+)(?::([^}]*))?\}\}/g, (_, k, label) => {
      const def = ctx.tags[k];
      const title = def && def.desc ? ` title="${def.desc}"` : '';
      return keep(`<span class="tag tag-${k}"${title}>${label || (def && def.label) || k}</span>`);
    });
    s = s.replace(/&lt;(https?:\/\/[^\s]+?)&gt;/g, (_, u) =>
      keep(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, u) => {
      const ext = isExternal(u) ? ' target="_blank" rel="noopener"' : '';
      return keep(`<a href="${safeHref(u)}"${ext}>`) + text + keep('</a>');
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/\u0001/g, '<br>');

    let prev;
    do { prev = s; s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[n]); } while (s !== prev);
    return s;
  }

  function cite(id, ctx) {
    const ref = ctx.refs.get(id);
    if (!ref) {
      ctx.warnings.push(`未定義の出典: [^${id}]`);
      return `<sup class="cite cite-bad" title="未定義の出典: ${id}">?</sup>`;
    }
    ref.uses++;
    return `<sup class="cite"><a href="#ref-${id}" id="cite-${id}-${ref.uses}" data-ref="${id}">${ref.n}</a></sup>`;
  }

  const plain = (t) => t.replace(/\[\^[\w-]+\]/g, '').replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`~]/g, '').trim();

  function slug(text, ctx) {
    let base = plain(text).toLowerCase().replace(/[\s　]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '') || 'section';
    let id = base, k = 2;
    while (ctx.ids.has(id)) id = `${base}-${k++}`;
    ctx.ids.add(id);
    return id;
  }

  /* ---------- render ---------- */

  function render(blocks, ctx) {
    return blocks.map((b) => {
      switch (b.t) {
        case 'h': {
          if (b.level === 1 && !ctx.h1Seen) { ctx.h1Seen = true; if (!ctx.title) ctx.title = plain(b.text); return ''; }
          const id = slug(b.text, ctx);
          if (b.level <= 3) ctx.toc.push({ level: b.level, text: plain(b.text), id });
          return `<h${b.level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inline(b.text, ctx)}</h${b.level}>`;
        }
        case 'p': return `<p>${inline(b.text, ctx)}</p>`;
        case 'hr': return '<hr>';
        case 'code': return `<pre class="code"><code${b.lang ? ` class="lang-${b.lang}" data-lang="${b.lang}"` : ''}>${esc(b.text)}</code></pre>`;
        case 'quote': return `<blockquote>${render(b.children, ctx)}</blockquote>`;
        case 'callout': {
          const label = b.title ? inline(b.title, ctx) : (CALLOUT[b.kind] || b.kind);
          return `<aside class="callout callout-${b.kind}"><div class="callout-title">${label}</div>${render(b.children, ctx)}</aside>`;
        }
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
          const lis = b.items.map((kids) => {
            if (kids[0] && kids[0].t === 'p') return `<li>${inline(kids[0].text, ctx)}${render(kids.slice(1), ctx)}</li>`;
            return `<li>${render(kids, ctx)}</li>`;
          }).join('');
          return `<${tag}${startAttr}>${lis}</${tag}>`;
        }
        case 'table': {
          const al = (j) => (b.aligns[j] ? ` style="text-align:${b.aligns[j]}"` : '');
          const th = b.head.map((c, j) => `<th${al(j)}>${inline(c, ctx)}</th>`).join('');
          const trs = b.rows.map((r) => `<tr>${b.head.map((_, j) => `<td${al(j)}>${inline(r[j] || '', ctx)}</td>`).join('')}</tr>`).join('');
          return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
        }
        case 'refs': {
          const lis = [...ctx.refs.values()].map((r) => {
            r.html = inline(r.text, ctx);
            return `<li id="ref-${r.id}" data-ref="${r.id}"><span class="refnum">${r.n}</span><div class="reftext">${r.html}</div></li>`;
          }).join('');
          return `<ol class="refs">${lis}</ol>`;
        }
        default: return '';
      }
    }).join('\n');
  }

  function parse(src) {
    const fm = parseFrontmatter(src.replace(/\r\n?/g, '\n'));
    const lines = fm.body.split('\n');
    const ctx = { refs: new Map(), tags: fm.tags, toc: [], ids: new Set(), warnings: [], title: fm.meta.title || '', refsPlaced: false };
    collectDefs(lines, ctx);
    const html = render(parseBlocks(lines, ctx), ctx);
    for (const r of ctx.refs.values()) {
      if (!r.uses) ctx.warnings.push(`本文で使われていない出典: [^${r.id}]`);
      if (r.html === undefined) r.html = inline(r.text, ctx);
    }
    return { meta: fm.meta, tags: fm.tags, title: ctx.title, html, toc: ctx.toc, refs: [...ctx.refs.values()], warnings: ctx.warnings };
  }

  const MD = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = MD;
  else root.MD = MD;
})(typeof window !== 'undefined' ? window : globalThis);
