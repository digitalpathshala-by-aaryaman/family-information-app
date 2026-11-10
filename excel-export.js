/* Offline, dependency-free .xlsx EXPORTER.
   Exports the currently entered family information; does not access Google Sheets,
   send data to a server, or export sign-in credentials/passphrases. */
(function (global) {
  'use strict';
  var enc = new TextEncoder();
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function col(n) {
    var r = '';
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) r = String.fromCharCode(65 + (n - 1) % 26) + r;
    return r;
  }
  function safeName(n) { return String(n || 'Sheet').replace(/[\\\/?*\[\]:]/g, '-').slice(0, 31); }
  function serialDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var t = Date.UTC(y, m - 1, d), check = new Date(t);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
  }
  function cell(ref, value, style, formula) {
    var a = ' r="' + ref + '"' + (style ? ' s="' + style + '"' : '');
    if (formula) {
      var numeric = isFinite(Number(value)) ? Number(value) : 0;
      return '<c' + a + '><f>' + esc(formula.slice(1)) + '</f><v>' + numeric + '</v></c>';
    }
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && isFinite(value)) return '<c' + a + '><v>' + value + '</v></c>';
    return '<c' + a + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
  }
  function row(n, cells) { return '<row r="' + n + '">' + cells.join('') + '</row>'; }
  function worksheet(rows, widths, freeze, filter, merges) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (freeze) xml += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    xml += '<sheetFormatPr defaultRowHeight="17"/><cols>' + widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols><sheetData>' + rows.join('') + '</sheetData>';
    if (filter) xml += '<autoFilter ref="' + filter + '"/>';
    if (merges && merges.length) xml += '<mergeCells count="' + merges.length + '">' + merges.map(function (x) { return '<mergeCell ref="' + x + '"/>'; }).join('') + '</mergeCells>';
    return xml + '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/></worksheet>';
  }
  var STYLE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;₹ &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="12"/><color rgb="FF183247"/><name val="Aptos"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B6459"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  // ZIP stored (no compression) for wide browser support: CRC32 + central directory.
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = [];
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[i] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var k = 0; k < bytes.length; k++) crc = crcTable[(crc ^ bytes[k]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function b16(view, offset, v) { view.setUint16(offset, v, true); }
  function b32(view, offset, v) { view.setUint32(offset, v >>> 0, true); }
  function pack(parts) {
    var chunks = [], directory = [], offset = 0;
    parts.forEach(function (part) {
      var name = enc.encode(part[0]), data = enc.encode(part[1]), crc = crc32(data);
      var local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      b32(lv, 0, 0x04034B50); b16(lv, 4, 20); b16(lv, 6, 0x0800);
      b16(lv, 8, 0); b32(lv, 14, crc); b32(lv, 18, data.length); b32(lv, 22, data.length);
      b16(lv, 26, name.length); local.set(name, 30);
      chunks.push(local, data);
      var central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      b32(cv, 0, 0x02014B50); b16(cv, 4, 20); b16(cv, 6, 20);
      b16(cv, 8, 0x0800); b16(cv, 10, 0); b32(cv, 16, crc);
      b32(cv, 20, data.length); b32(cv, 24, data.length); b16(cv, 28, name.length);
      b32(cv, 42, offset); central.set(name, 46); directory.push(central);
      offset += local.length + data.length;
    });
    var dirSize = directory.reduce(function (n, x) { return n + x.length; }, 0);
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    b32(ev, 0, 0x06054B50); b16(ev, 8, parts.length); b16(ev, 10, parts.length);
    b32(ev, 12, dirSize); b32(ev, 16, offset);
    return new Blob(chunks.concat(directory, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function isVisible(f, r) {
    if (!f.when) return true;
    if (f.when.k === 'nomReg') return r.nomReg === 'Yes' || (!r.nomReg && !!r.nominee);
    if (f.when.k === 'holding') return r.holding === 'Joint' || (!r.holding && !!r.jointHolder);
    if (f.when.k === 'locker') return r.locker === 'Yes' || (!r.locker && !!r.lockerNo);
    if (f.when.k === 'nominee' && r.nomReg === 'No') return false;
    return r[f.when.k] === f.when.eq;
  }
  function build(state, blocks, config) {
    if (!state || !blocks || !blocks.length) throw new Error('No book data available.');
    config = config || {};
    var sheets = [{ name: 'Dashboard', rows: [], widths: [35, 25, 22, 23, 22, 22], freeze: false, merges: ['A1:F1', 'A3:F3', 'A23:F23', 'A24:F24', 'A25:F25', 'A26:F26'] }];
    var summary = { family: 0, bank: 0, fd: 0, inv: 0, ins: 0, prop: 0, loan: 0, nom: 0,
      bankTotal: 0, fdTotal: 0, invTotal: 0, premiumYear: 0, emiMonth: 0, billMonth: 0 };
    var names = {};
    blocks.forEach(function (b) {
      var name = safeName(b.title);
      if (names[name]) throw new Error('Duplicate worksheet: ' + name);
      names[name] = true;
      var fields = b.fields, rows = [], widths = fields.map(function (f) {
        return Math.min(36, Math.max(17, f.l.length + 4));
      });
      var computed = b.id === 'ins' ? 'Annual premium (₹)' : b.id === 'inv' ? 'Yearly SIP (₹)' : b.id === 'bill' ? 'Monthly equivalent (₹)' : null;
      if (b.kind === 'single') {
        rows.push(row(1, [cell('A1', 'Item', 1), cell('B1', 'Value', 1)]));
        (fields || []).forEach(function (f, i) {
          var value = (state[b.id] || {})[f.k], style = f.t === 'num' ? 3 : f.t === 'date' ? 4 : 0;
          if (f.t === 'date') value = serialDate(value) || value;
          rows.push(row(i + 2, [cell('A' + (i + 2), f.l, 2), cell('B' + (i + 2), value, style)]));
        });
        sheets.push({ name: name, rows: rows, widths: [42, 62], freeze: true });
      } else {
        var headers = fields.map(function (f) { return f.l; });
        if (computed) headers.push(computed);
        rows.push(row(1, headers.map(function (h, i) { return cell(col(i) + '1', h, 1); })));
        var data = Array.isArray(state[b.id]) ? state[b.id] : [];
        data.forEach(function (r, i) {
          var n = i + 2, cells = [];
          fields.forEach(function (f, j) {
            var value = isVisible(f, r) ? r[f.k] : '', style = 0;
            if (f.t === 'date') { var date = serialDate(value); if (date !== null) { value = date; style = 4; } }
            if (f.t === 'num') style = 3;
            // A custom nominee is entered as an additional field; do not export secrets or cloud auth keys.
            cells.push(cell(col(j) + n, value, style));
          });
          if (computed) {
            var amountKey = b.id === 'ins' ? 'premium' : b.id === 'inv' ? 'sip' : 'amount';
            var modeKey = b.id === 'ins' || b.id === 'bill' ? 'freq' : 'sipAct';
            var amountCol = col(fields.findIndex(function (f) { return f.k === amountKey; }));
            var modeCol = col(fields.findIndex(function (f) { return f.k === modeKey; }));
            var A = amountCol + n, F = modeCol + n, formula;
            if (b.id === 'ins') formula = '=IFERROR(' + A + '*IF(' + F + '="Monthly",12,IF(' + F + '="Quarterly",4,IF(' + F + '="Half-yearly",2,IF(' + F + '="Yearly",1,0)))),0)';
            else if (b.id === 'inv') formula = '=IF(' + F + '="Stop",0,IFERROR(' + A + '*12,0))';
            else formula = '=IFERROR(' + A + '*IF(' + F + '="Monthly",1,IF(' + F + '="Quarterly",1/3,IF(' + F + '="Half-yearly",1/6,IF(' + F + '="Yearly",1/12,0)))),0)';
            var numeric = Number(r[amountKey]) || 0, freq = String(r[modeKey] || '');
            var cached = b.id === 'ins' ? numeric * ((config.frequency || {})[freq] || 0) :
              b.id === 'inv' ? (freq === 'Stop' ? 0 : numeric * 12) : numeric * ((config.frequency || {})[freq] || 0) / 12;
            cells.push(cell(col(fields.length) + n, cached, 3, formula));
          }
          rows.push(row(n, cells));
        });
        if (computed) widths.push(25);
        sheets.push({ name: name, rows: rows, widths: widths, freeze: true, filter: 'A1:' + col(headers.length - 1) + Math.max(2, data.length + 1) });
        summary[b.id] = data.length;
        if (b.id === 'bank') summary.bankTotal = data.reduce(function (n, x) { return n + (Number(x.balance) || 0); }, 0);
        if (b.id === 'fd') summary.fdTotal = data.reduce(function (n, x) { return n + (Number(x.amount) || 0); }, 0);
        if (b.id === 'inv') summary.invTotal = data.reduce(function (n, x) { return n + (Number(x.value) || 0); }, 0);
        if (b.id === 'ins') summary.premiumYear = data.reduce(function (n, x) { return n + (Number(x.premium) || 0) * ((config.frequency || {})[x.freq] || 0); }, 0);
        if (b.id === 'loan') summary.emiMonth = data.reduce(function (n, x) { return n + (Number(x.emi) || 0); }, 0);
        if (b.id === 'bill') summary.billMonth = data.reduce(function (n, x) { return n + (Number(x.amount) || 0) * ((config.frequency || {})[x.freq] || 0) / 12; }, 0);
      }
    });
    // Read-only nomination register from the other sections. It is kept separate
    // from manual nomination rows so importing this export won't create duplicates.
    var linkedNominations = global.FamilyNomination ? FamilyNomination.linked(state) : [];
    var nomineeHeaders = ['Source section','Holder name','Account / policy','Nominee name','Relationship','Nominee added?','Last updated'];
    var nomineeRows = [row(1, nomineeHeaders.map(function (v, i) { return cell(col(i) + '1', v, 1); }))];
    linkedNominations.forEach(function (r, i) {
      nomineeRows.push(row(i + 2, [r.source,r.holder,r.asset,r.nominee,r.relationship,r.status,r.checked].map(function (v, j) {
        return cell(col(j) + (i + 2), v, 0);
      })));
    });
    sheets.push({ name: 'Linked nominations', rows: nomineeRows, widths: [20,23,33,24,22,19,20], freeze:true,
      filter:'A1:G' + Math.max(2, linkedNominations.length + 1) });
    // Export checked steps as well as the data-entry sections.
    var steps = Array.isArray(config.checks) ? config.checks : [];
    var checkRows = [row(1, [cell('A1','First 48 hours — action',1),cell('B1','Completed?',1)])];
    steps.forEach(function (task, i) {
      checkRows.push(row(i + 2, [cell('A' + (i + 2), task), cell('B' + (i + 2), state.checks && state.checks['c' + i] ? 'Yes' : 'No')]));
    });
    sheets.push({ name:'First 48 hours', rows:checkRows, widths:[92,20], freeze:true });
    var guides = Array.isArray(config.guides) ? config.guides : [];
    var guideRows = [row(1, [cell('A1','India process',1),cell('B1','Basic steps',1),cell('C1','Official website (if available)',1)])];
    guides.forEach(function (guide, i) {
      guideRows.push(row(i + 2, [cell('A' + (i + 2),guide.t), cell('B' + (i + 2),(guide.s || []).join(' | ')),
        cell('C' + (i + 2),(guide.l && guide.l[1]) || '')]));
    });
    sheets.push({ name:'India quick help', rows:guideRows, widths:[29,110,50], freeze:true });
    var blockBy = {};
    blocks.forEach(function (b) { blockBy[b.id] = b; });
    function columnOf(id, field) {
      return col(blockBy[id].fields.findIndex(function (f) { return f.k === field; }));
    }
    function ref(id) { return "'" + safeName(blockBy[id].title).replace(/'/g, "''") + "'!"; }
    function count(id, key) { return '=COUNTA(' + ref(id) + columnOf(id, key) + '2:' + columnOf(id, key) + '10000)'; }
    function sum(id, key) { return '=SUM(' + ref(id) + columnOf(id, key) + '2:' + columnOf(id, key) + '10000)'; }
    function sumCalc(id) { return '=SUM(' + ref(id) + col(blockBy[id].fields.length) + '2:' + col(blockBy[id].fields.length) + '10000)'; }
    var dash = [], add = function (n, values, styles, formulas) {
      dash.push(row(n, values.map(function (v, i) { return cell(col(i) + n, v, styles && styles[i] || 0, formulas && formulas[i]); })));
    };
    add(1, ['FAMILY INFORMATION BOOK — INDIA'], [1]);
    add(2, ['Export date', config.today || '', 'Private family reference'], [2, 0, 0]);
    add(3, ['YOUR FAMILY AT A GLANCE'], [1]);
    add(4, ['Item', 'Count / amount', 'Unit'], [1, 1, 1]);
    add(5, ['Family members', summary.family + (state.me && state.me.name ? 1 : 0), 'people', '', '', ''], [0, 0, 0], [null, '=COUNTA(' + ref('family') + 'A2:A10000)+IF(' + ref('me') + 'B2="",0,1)']);
    var metrics = [
      [6, 'Bank accounts', summary.bank, 'accounts', count('bank', 'bank')],
      [7, 'FDs and RDs', summary.fd, 'deposits', count('fd', 'bank')],
      [8, 'Investments', summary.inv, 'records', count('inv', 'type')],
      [9, 'Insurance policies', summary.ins, 'policies', count('ins', 'type')],
      [10, 'Properties', summary.prop, 'properties', count('prop', 'type')],
      [11, 'Loans', summary.loan, 'loans', count('loan', 'lender')],
      [12, 'Nomination entries', summary.nom + linkedNominations.length, 'records', count('nom', 'asset') + "+COUNTA('Linked nominations'!A2:A10000)"],
      [14, 'Bank balances', summary.bankTotal, '₹', sum('bank', 'balance')],
      [15, 'Total deposits recorded', summary.fdTotal, '₹', sum('fd', 'amount')],
      [16, 'Current investment value', summary.invTotal, '₹', sum('inv', 'value')],
      [17, 'Insurance premium per year', summary.premiumYear, '₹ / year', sumCalc('ins')],
      [18, 'Monthly loan EMI', summary.emiMonth, '₹ / month', sum('loan', 'emi')],
      [19, 'Monthly household bills', summary.billMonth, '₹ / month', sumCalc('bill')]
    ];
    metrics.forEach(function (m) {
      add(m[0], [m[1], m[2], m[3]], [m[0] >= 14 ? 2 : 0, m[0] >= 14 ? 6 : 0, 0], [null, m[4]]);
    });
    add(21, ['This workbook contains the information entered in the app.'], [2]);
    add(23, ['IMPORTANT: This file contains private family details. Store it securely.'], [2]);
    add(24, ['Never record bank passwords, OTPs, PINs or recovery phrases in this workbook.']);
    add(25, ['Amounts reflect what you entered; they are not live investment valuations.']);
    add(26, ['Nomination alone does not determine legal ownership or inheritance.']);
    sheets[0].rows = dash;
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' + sheets.map(function (s, i) {
        return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>';
    var parts = [
      ['[Content_Types].xml', ct],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', rels], ['xl/styles.xml', STYLE]
    ];
    sheets.forEach(function (s, i) { parts.push(['xl/worksheets/sheet' + (i + 1) + '.xml', worksheet(s.rows, s.widths, s.freeze, s.filter, s.merges)]); });
    return pack(parts);
  }
  global.FamilyExcelExport = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
