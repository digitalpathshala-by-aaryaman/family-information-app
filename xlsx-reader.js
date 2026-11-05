/* Minimal, dependency-free .xlsx reader.
   Reads the first worksheet tables of a workbook into arrays of rows.
   Uses DecompressionStream('deflate-raw'), available in current browsers. */
(function (global) {
  'use strict';

  function u16(v, o) { return v[o] | (v[o + 1] << 8); }
  function u32(v, o) { return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0; }

  function xmlDecode(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    });
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot open .xlsx files. Save the file as CSV or use a current browser.');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Returns a map of file name -> Uint8Array (contents) for every entry in the zip.
  async function unzip(buf) {
    var v = new Uint8Array(buf);
    var eocd = -1;
    for (var i = v.length - 22; i >= Math.max(0, v.length - 65557); i--) {
      if (u32(v, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The file is not a valid Excel (.xlsx) workbook.');
    var count = u16(v, eocd + 10);
    var p = u32(v, eocd + 16);
    var files = {};
    for (var n = 0; n < count; n++) {
      if (u32(v, p) !== 0x02014b50) throw new Error('Workbook index is damaged.');
      var method = u16(v, p + 10);
      var csize = u32(v, p + 20);
      var nlen = u16(v, p + 28), xlen = u16(v, p + 30), clen = u16(v, p + 32);
      var local = u32(v, p + 42);
      var name = new TextDecoder().decode(v.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      var lnlen = u16(v, local + 26), lxlen = u16(v, local + 28);
      var start = local + 30 + lnlen + lxlen;
      var data = v.subarray(start, start + csize);
      if (method === 0) files[name] = data;
      else if (method === 8) files[name] = await inflateRaw(data);
      else throw new Error('Unsupported compression in workbook.');
    }
    return files;
  }

  function parseSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var t = '', tr = /<t[^>]*>([\s\S]*?)<\/t>/g, x;
      while ((x = tr.exec(m[1]))) t += xmlDecode(x[1]);
      out.push(t);
    }
    return out;
  }

  function colIndex(ref) {
    var s = ref.replace(/[0-9]/g, ''), n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseSheet(xml, shared) {
    var rows = [];
    var re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(xml))) {
      var attrs = m[1], body = m[2] || '';
      var r = /\br="([A-Z]+[0-9]+)"/.exec(attrs);
      if (!r) continue;
      var t = /\bt="([^"]+)"/.exec(attrs);
      var type = t ? t[1] : 'n';
      var rowNum = parseInt(r[1].replace(/[A-Z]/g, ''), 10) - 1;
      var col = colIndex(r[1]);
      var val = '';
      if (type === 'inlineStr') {
        var it = /<t[^>]*>([\s\S]*?)<\/t>/g, x;
        while ((x = it.exec(body))) val += xmlDecode(x[1]);
      } else {
        var vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vm) {
          if (type === 's') val = shared[parseInt(vm[1], 10)] || '';
          else if (type === 'str') val = xmlDecode(vm[1]);
          else if (type === 'b') val = vm[1] === '1';
          else val = Number(vm[1]);
        }
      }
      while (rows.length <= rowNum) rows.push([]);
      rows[rowNum][col] = val;
    }
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < rows[i].length; j++) if (rows[i][j] === undefined) rows[i][j] = '';
    }
    return rows;
  }

  // Returns [{name, rows}] for every worksheet in the workbook.
  async function readWorkbook(buf) {
    var files = await unzip(buf);
    var td = new TextDecoder();
    var wbXml = td.decode(files['xl/workbook.xml'] || new Uint8Array());
    var relXml = td.decode(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
    var shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? td.decode(files['xl/sharedStrings.xml']) : '');
    var rels = {};
    var rr = /<Relationship\s[^>]*>/g, m, tag;
    while ((tag = rr.exec(relXml))) {
      var id = /\bId="([^"]+)"/.exec(tag[0]), tg = /\bTarget="([^"]+)"/.exec(tag[0]);
      if (id && tg) rels[id[1]] = tg[1];
    }
    var sheets = [];
    var sr = /<sheet\s[^>]*>/g, sTag;
    while ((sTag = sr.exec(wbXml))) {
      m = [null, (/\bname="([^"]+)"/.exec(sTag[0]) || [])[1], (/\br:id="([^"]+)"/.exec(sTag[0]) || [])[1]];
      if (!m[1] || !m[2]) continue;
      var target = rels[m[2]] || '';
      var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
      var part = files[path];
      if (!part) continue;
      sheets.push({ name: xmlDecode(m[1]), rows: parseSheet(td.decode(part), shared) });
    }
    return sheets;
  }

  global.XlsxReader = { readWorkbook: readWorkbook };
})(typeof window !== 'undefined' ? window : globalThis);
