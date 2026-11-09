(function () {
  'use strict';
  var BYID = {};
  BLOCKS.forEach(function (b) { BYID[b.id] = b; });
  var OLD_KEY = 'family-information-book-india-v1';

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(String(v).replace(/[₹,\s]/g, '')); return isNaN(n) ? 0 : n; }
  function fmt(n) { return '₹ ' + Math.round(n || 0).toLocaleString('en-IN'); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function prettyDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function daysFromToday(iso) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((new Date(iso + 'T00:00:00').getTime() - t.getTime()) / 864e5);
  }
  function dueText(d) {
    if (d < 0) return 'Overdue by ' + (-d) + (d === -1 ? ' day' : ' days');
    if (d === 0) return 'Due today';
    return 'In ' + d + (d === 1 ? ' day' : ' days');
  }
  function rowLabel(b, r) {
    for (var i = 0; i < b.fields.length; i++) {
      var f = b.fields[i];
      if (f.t === 'text' && r[f.k]) return String(r[f.k]);
    }
    return b.title;
  }
  function status(msg) {
    // Keep ordinary UI feedback separate from the online/offline save confirmation.
    var cloud = window.CloudSync && CloudSync.configured;
    var el = document.getElementById(cloud ? 'activity-status' : 'status');
    if (el) el.textContent = msg || '';
  }
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- state ---------- */
  function blank() {
    var s = { checks: {} };
    BLOCKS.forEach(function (b) { s[b.id] = b.kind === 'single' ? {} : []; });
    return s;
  }
  function merge(o) {
    var s = blank();
    if (o && typeof o === 'object') {
      BLOCKS.forEach(function (b) {
        var v = o[b.id];
        var ok = b.kind === 'single' ? (v && typeof v === 'object' && !Array.isArray(v)) : Array.isArray(v);
        if (ok) s[b.id] = v;
      });
      if (o.checks && typeof o.checks === 'object') s.checks = o.checks;
    }
    return s;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      return raw ? merge(JSON.parse(raw)) : blank();
    } catch (e) { return blank(); }
  }
  var state = (window.CloudSync && CloudSync.configured) ? blank() : load();
  var saveTimer = null;
  function save() {
    if (window.CloudSync && CloudSync.configured) {
      if (CloudSync.active) CloudSync.push(state);
      else status('Please unlock your family book before editing.');
      return;
    }
    // Offline-only mode: synchronous storage on EVERY field edit, not after a delayed timer.
    try { localStorage.setItem(KEY, JSON.stringify(state)); status('Saved on this device.'); }
    catch (e) { status('WARNING: Could not save on this device. Storage may be full or blocked.'); }
  }

  /* ---------- totals and summaries ---------- */
  function rowsOf(id) { return state[id] || []; }
  function totals() {
    var t = { bankBal: 0, fd: 0, inv: 0, sip: 0, premium: 0, emi: 0, bills: 0 };
    rowsOf('bank').forEach(function (r) { t.bankBal += num(r.balance); });
    rowsOf('fd').forEach(function (r) { t.fd += num(r.amount); });
    rowsOf('inv').forEach(function (r) {
      t.inv += num(r.value);
      if (r.sipAct !== 'Stop') t.sip += num(r.sip);
    });
    rowsOf('ins').forEach(function (r) { t.premium += num(r.premium) * (PERYEAR[r.freq] || 0); });
    rowsOf('loan').forEach(function (r) { t.emi += num(r.emi); });
    rowsOf('bill').forEach(function (r) { t.bills += num(r.amount) * (PERYEAR[r.freq] || 0) / 12; });
    return t;
  }
  function blockLastUpdated(b) {
    var latest = '';
    if (b.kind === 'single') return state[b.id]._upd || '';
    state[b.id].forEach(function (r) { if (r._upd && r._upd > latest) latest = r._upd; });
    return latest;
  }
  function bookLastUpdated() {
    var latest = '';
    BLOCKS.forEach(function (b) {
      var u = blockLastUpdated(b);
      if (u && u > latest) latest = u;
    });
    return latest;
  }
  function staleCount() {
    var n = 0;
    ['bank', 'fd', 'inv', 'loan'].forEach(function (id) {
      rowsOf(id).forEach(function (r) {
        if (!r._upd) return;
        if (-daysFromToday(r._upd) > STALE_DAYS) n++;
      });
    });
    return n;
  }
  function byBank() {
    var map = {}, order = [];
    function get(name) {
      var clean = String(name || '').trim();
      var key = clean ? clean.toLowerCase() : '(bank not entered)';
      if (!map[key]) { map[key] = { name: clean || 'Bank not entered', accounts: 0, balance: 0, fds: 0, fdTotal: 0 }; order.push(key); }
      return map[key];
    }
    rowsOf('bank').forEach(function (r) { var g = get(r.bank); g.accounts++; g.balance += num(r.balance); });
    rowsOf('fd').forEach(function (r) { var g = get(r.bank); g.fds++; g.fdTotal += num(r.amount); });
    return order.map(function (k) { return map[k]; });
  }
  function alerts() {
    var out = [];
    BLOCKS.forEach(function (b) {
      if (b.kind !== 'table') return;
      var dates = b.fields.filter(function (f) { return f.alert; });
      if (!dates.length) return;
      state[b.id].forEach(function (r) {
        dates.forEach(function (f) {
          if (!r[f.k]) return;
          var d = daysFromToday(r[f.k]);
          if (d <= CHECK_DAYS) out.push({ b: b.title, l: rowLabel(b, r), f: f.l, d: d, g: b.g });
        });
      });
    });
    return out.sort(function (x, y) { return x.d - y.d; });
  }
  function todos() {
    var L = [], me = state.me, plan = state.plan, n;
    if (!me.name) L.push('Add your name in “About me”.');
    if (!me.blood) L.push('Add your blood group in “About me”.');
    if (rowsOf('contacts').filter(function (r) { return r.phone; }).length < 2) L.push('Add at least two emergency contacts with phone numbers.');
    var cats = rowsOf('keys').map(function (r) { return r.cat; });
    if (cats.indexOf('Police station') < 0) L.push('Add the nearest police station.');
    if (cats.indexOf('Hospital (emergency)') < 0) L.push('Add the nearest hospital.');
    if (!plan.keysLoc) L.push('Note where the house and locker keys are kept.');
    if (!plan.lockerLoc) L.push('Note where important papers and the locker are.');
    if (!plan.will || plan.will === 'Not sure') L.push('Confirm whether a will exists.');
    n = rowsOf('bank').filter(function (r) { return r.balance !== '' && r.balance !== undefined && !r.asOf; }).length;
    if (n) L.push(n + ' bank balance(s) have no “Balance as on” date.');
    n = rowsOf('nom').filter(function (r) { return r.status !== 'Verified'; }).length;
    if (n) L.push(n + ' nomination(s) need checking.');
    n = rowsOf('ins').filter(function (r) { return !r.nominee; }).length;
    if (n) L.push(n + ' insurance policy(ies) have no nominee name.');
    n = rowsOf('ins').filter(function (r) { return num(r.premium) > 0 && !r.freq; }).length;
    if (n) L.push('Choose how often each insurance premium is paid.');
    n = rowsOf('loan').filter(function (r) { return r.action === 'Needs decision'; }).length;
    if (n) L.push(n + ' loan(s) need a decision.');
    n = rowsOf('dig').filter(function (r) { return r.recovery === 'Not set up' || r.recovery === 'Not sure'; }).length;
    if (n) L.push(n + ' online account(s) without recovery set up.');
    return L;
  }

  /* ---------- rendering: forms ---------- */
  function control(f, b, i, val) {
    var v = (val === undefined || val === null) ? '' : val;
    var a = ' data-b="' + b.id + '" data-i="' + i + '" data-k="' + f.k + '" aria-label="' + esc(f.l) + '"' + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '');
    if (f.t === 'sel') {
      return '<select' + a + '><option value="">Choose</option>' + f.o.map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select>';
    }
    if (f.t === 'area') return '<textarea rows="2"' + a + '>' + esc(v) + '</textarea>';
    var type = f.t === 'date' ? 'date' : f.t === 'tel' ? 'tel' : f.t === 'num' ? 'number' : 'text';
    var extra = f.t === 'num' ? ' inputmode="decimal" min="0" step="any"' : '';
    return '<input type="' + type + '"' + extra + ' value="' + esc(v) + '"' + a + '>';
  }

  function renderBlock(b) {
    var el = document.getElementById('b-' + b.id);
    if (!el) return;
    var data = state[b.id];
    var h = '<h3>' + esc(b.title) + '</h3><p class="hint">' + esc(b.hint) + '</p>';
    if (b.kind === 'single') {
      h += '<div class="grid-form">' + b.fields.map(function (f) {
        return '<label class="fld' + (f.wide || f.t === 'area' ? ' wide' : '') + '"><span>' + esc(f.l) + '</span>' + control(f, b, 's', data[f.k]) + '</label>';
      }).join('') + '</div>';
    } else {
      if (!data.length) {
        h += '<p class="empty">Nothing added yet. Press “Add a row” to start, or import from Excel.</p>';
      } else {
        h += '<div class="tscroll"><table class="entry"><thead><tr>' + b.fields.map(function (f) {
          return '<th>' + esc(f.l) + '</th>';
        }).join('') + '<th class="actcol"><span class="sr">Actions</span></th></tr></thead><tbody>';
        data.forEach(function (r, i) {
          h += '<tr>' + b.fields.map(function (f) {
            return '<td data-label="' + esc(f.l) + '">' + control(f, b, i, r[f.k]) + '</td>';
          }).join('') + '<td class="actcol">' +
            '<button type="button" class="row-act" data-dup="' + b.id + '" data-i="' + i + '">Duplicate</button> ' +
            '<button type="button" class="row-act del" data-del="' + b.id + '" data-i="' + i + '">Remove</button></td></tr>';
        });
        h += '</tbody></table></div>';
      }
      h += '<button type="button" class="add" data-add="' + b.id + '">+ Add a row</button>';
    }
    var lu = blockLastUpdated(b);
    h += '<p class="upd">' + (lu ? 'Last updated: ' + prettyDate(lu) : 'Not updated yet') + '</p>';
    el.innerHTML = h;
  }

  /* ---------- rendering: dashboard ---------- */
  function renderDash() {
    var t = totals();
    var contactsWithPhone = rowsOf('contacts').filter(function (r) { return r.phone; }).length;
    var cards = [
      { g: 'money', n: rowsOf('bank').length, t: 'Bank accounts', s: fmt(t.bankBal) + ' total balance', dateKey: 'bank' },
      { g: 'money', n: rowsOf('fd').length, t: 'Fixed and recurring deposits', s: fmt(t.fd) + ' total deposited', dateKey: 'fd' },
      { g: 'money', n: rowsOf('inv').length, t: 'Investments', s: fmt(t.inv) + ' current value', dateKey: 'inv' },
      { g: 'money', n: rowsOf('inv').filter(function (r) { return num(r.sip) > 0 && r.sipAct !== 'Stop'; }).length, t: 'SIPs running', s: fmt(t.sip) + ' per month', dateKey: 'inv' },
      { g: 'ins', n: rowsOf('ins').length, t: 'Insurance policies', s: fmt(t.premium) + ' premiums per year', dateKey: 'ins' },
      { g: 'home', n: rowsOf('loan').length, t: 'Loans', s: fmt(t.emi) + ' EMIs per month', dateKey: 'loan' },
      { g: 'home', n: rowsOf('bill').length, t: 'Bills and subscriptions', s: fmt(t.bills) + ' per month (approx.)', dateKey: 'bill' },
      { g: 'home', n: rowsOf('prop').length, t: 'Properties', s: 'Recorded properties', dateKey: 'prop' },
      { g: 'home', n: rowsOf('veh').length, t: 'Vehicles', s: 'Recorded vehicles', dateKey: 'veh' },
      { g: 'family', n: rowsOf('family').length, t: 'Family members', s: contactsWithPhone + ' emergency contacts with phone', dateKey: 'family' },
      { g: 'papers', n: rowsOf('docs').length, t: 'Important papers', s: 'Where each original is kept', dateKey: 'docs' },
      { g: 'papers', n: rowsOf('nom').length, t: 'Nominations', s: rowsOf('nom').filter(function (r) { return r.status !== 'Verified'; }).length + ' need checking', dateKey: 'nom' }
    ];
    document.getElementById('dash-stats').innerHTML = cards.map(function (c) {
      return '<a class="stat" href="#sec-' + c.g + '"><div class="n">' + c.n + '</div><div class="t">' + esc(c.t) + '</div>' +
        '<div class="s">' + esc(c.s) + '</div><div class="u">Last updated: ' + (blockLastUpdated(BYID[c.dateKey]) ? prettyDate(blockLastUpdated(BYID[c.dateKey])) : 'not yet') + '</div></a>';
    }).join('');

    var bl = bookLastUpdated();
    var stale = staleCount();
    document.getElementById('dash-updated').innerHTML =
      'Book last updated: <b>' + (bl ? prettyDate(bl) : 'not yet') + '</b>' +
      (stale ? ' · <span class="stale">' + stale + ' balance(s) not updated for ' + STALE_DAYS + '+ days</span>' : '');

    var banks = byBank();
    document.getElementById('dash-banks').innerHTML = banks.length ?
      '<div class="tscroll"><table class="bank"><thead><tr><th>Bank</th><th class="num">Accounts</th><th class="num">Balance</th><th class="num">FDs</th><th class="num">FD total</th></tr></thead><tbody>' +
      banks.map(function (g) {
        return '<tr><td>' + esc(g.name) + '</td><td class="num">' + g.accounts + '</td><td class="num">' + fmt(g.balance) +
          '</td><td class="num">' + g.fds + '</td><td class="num">' + fmt(g.fdTotal) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<p class="empty">Add bank accounts or fixed deposits to see the bank-wise summary.</p>';

    var al = alerts();
    document.getElementById('dash-alerts').innerHTML = al.length ? al.map(function (a) {
      var cls = a.d < 0 ? 'over' : a.d <= 14 ? 'soon' : '';
      return '<div class="row-item"><span>' + esc(a.l) + ' <small>· ' + esc(a.b) + ': ' + esc(a.f) + '</small></span><span class="due ' + cls + '">' + esc(dueText(a.d)) + '</span></div>';
    }).join('') : '<p class="empty">Nothing due in the next ' + CHECK_DAYS + ' days.</p>';

    var td = todos();
    document.getElementById('dash-todo').innerHTML = td.length ?
      '<ul class="todo">' + td.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' :
      '<p class="empty">The essentials are filled in. Review this book once a year.</p>';
  }

  /* ---------- emergency card ---------- */
  function renderCard() {
    var el = document.getElementById('card');
    if (!el) return;
    var me = state.me, med = state.medical, plan = state.plan, t = totals();
    function pick(cat) { return rowsOf('keys').filter(function (r) { return r.cat === cat; })[0] || {}; }
    function who(r) { return [r.name, r.phone].filter(Boolean).join(' '); }
    function dt(k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : ''; }
    var contacts = rowsOf('contacts').filter(function (r) { return r.phone; }).slice(0, 2);
    var health = rowsOf('ins').filter(function (r) { return r.type === 'Health'; })[0] || {};
    var nDecide = rowsOf('loan').filter(function (r) { return r.action === 'Needs decision'; }).length;
    var nLoans = rowsOf('loan').filter(function (r) { return num(r.emi) > 0; }).length;
    var nCancel = rowsOf('bill').filter(function (r) { return r.action === 'Cancel'; }).length;
    var nStop = rowsOf('inv').filter(function (r) { return r.sipAct === 'Stop'; }).length;
    el.innerHTML = '<div class="sheet">' +
      '<h3>Emergency card' + (me.name ? ' · ' + esc(me.name) : '') + '</h3>' +
      '<dl>' + dt('Blood group', me.blood) + dt('Home address', me.address) + '</dl>' +
      '<h4>Call these people</h4><dl>' + (contacts.map(function (c, i) {
        return dt('Contact ' + (i + 1), (c.name || '') + (c.rel ? ' (' + c.rel + ')' : '') + ' ' + c.phone + (c.alt ? ' / ' + c.alt : ''));
      }).join('') || dt('Contacts', 'Add two emergency contacts')) + '</dl>' +
      '<h4>Medical</h4><dl>' + dt('Conditions', med.conditions) + dt('Allergies', med.allergies) + dt('Regular medicines', med.medicines) +
        dt('Doctor', [med.doctor, med.doctorPhone].filter(Boolean).join(' ')) + dt('Hospital', med.hospital) +
        dt('Health insurance', [health.company, health.ref].filter(Boolean).join(' · ')) + '</dl>' +
      '<h4>Nearby help</h4><dl>' + dt('Police station', who(pick('Police station'))) + dt('Hospital', who(pick('Hospital (emergency)'))) +
        dt('Family doctor', who(pick('Family doctor'))) + dt('Neighbour', who(pick('Trusted neighbour'))) +
        dt('Building security', who(pick('Building security / society office'))) + '</dl>' +
      '<h4>Professionals</h4><dl>' + dt('Chartered Accountant', who(pick('Chartered Accountant (CA)'))) + dt('Lawyer', who(pick('Lawyer'))) +
        dt('Employer / HR', who(pick('Employer / HR'))) + dt('Insurance agent', who(pick('Insurance agent'))) + '</dl>' +
      '<h4>First steps</h4><dl>' + dt('Call first', plan.firstCall) + dt('Keys', plan.keysLoc) + dt('Papers and locker', plan.lockerLoc) +
        dt('Recovery', plan.recovery) + dt('Will', [plan.will, plan.willLoc ? 'kept at ' + plan.willLoc : ''].filter(Boolean).join(' · ')) +
        dt('Immediate steps', plan.steps) + '</dl>' +
      '<h4>Money to act on</h4><dl>' + dt('Loan EMIs', nLoans ? fmt(t.emi) + ' a month across ' + nLoans + ' loan(s)' : '') +
        dt('Loans to decide', nDecide ? nDecide + ' loan(s)' : '') + dt('Bills to cancel', nCancel ? nCancel + ' bill(s)' : '') +
        dt('SIPs to stop', nStop ? nStop + ' SIP(s)' : '') + '</dl>' +
      '<h4>Emergency numbers</h4><p class="nums">112 all emergencies · 108 ambulance (most states) · 100 police · 101 fire</p>' +
      '<p class="hint">Keep this card with you or a trusted person. It holds no passwords.</p></div>';
  }

  /* ---------- help ---------- */
  function renderHelp() {
    var el = document.getElementById('help-body');
    if (!el) return;
    var h = '<div class="card"><h3>First 48 hours</h3><p class="hint">Tick items as you go. Ticks are saved on this device.</p><div class="check">';
    CHECKLIST.forEach(function (c, i) {
      var k = 'c' + i;
      h += '<label><input type="checkbox" data-check="' + k + '"' + (state.checks[k] ? ' checked' : '') + '><span>' + esc(c) + '</span></label>';
    });
    h += '</div></div><div class="card"><h3>Step-by-step guides</h3><p class="hint">General guidance only. Rules vary by state and institution, so confirm before acting.</p>';
    PROCS.forEach(function (p) {
      h += '<details><summary>' + esc(p.t) + '</summary><ul>' + p.s.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      if (p.l) h += '<p><a href="' + esc(p.l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(p.l[0]) + '</a></p>';
      h += '</details>';
    });
    el.innerHTML = h + '</div>';
  }

  /* ---------- page build ---------- */
  function build() {
    var main = document.getElementById('main'), jump = document.getElementById('jump');
    var nav = '', html = '';
    GROUPS.forEach(function (g) {
      nav += '<a href="#sec-' + g.id + '">' + esc(g.title) + '</a>';
      html += '<section class="sec" id="sec-' + g.id + '"><h2>' + esc(g.title) + '</h2>';
      if (g.id === 'dash') {
        html += '<p class="hint" id="dash-updated"></p>' +
          '<p class="hint">Tap any box to open its section. Totals update as you type.</p>' +
          '<div class="stats" id="dash-stats"></div>' +
          '<div class="card"><h3>Bank-wise summary</h3><p class="hint">Accounts and FDs grouped by bank.</p><div id="dash-banks"></div></div>' +
          '<div class="two"><div class="card"><h3>Dates to watch</h3><p class="hint">Due in the next ' + CHECK_DAYS + ' days, or already overdue.</p><div id="dash-alerts"></div></div>' +
          '<div class="card"><h3>To complete</h3><p class="hint">Quick gaps to close.</p><div id="dash-todo"></div></div></div>';
      } else if (g.id === 'help') {
        html += '<div id="help-body"></div>';
      } else if (g.id === 'card') {
        html += '<div id="card"></div>';
      } else {
        BLOCKS.filter(function (b) { return b.g === g.id; }).forEach(function (b) {
          html += '<article class="card" id="b-' + b.id + '"></article>';
        });
      }
      html += '</section>';
    });
    main.innerHTML = html;
    jump.innerHTML = nav;
  }
  function renderAll() {
    BLOCKS.forEach(renderBlock);
    renderDash();
    renderHelp();
    renderCard();
  }
  function refresh() { renderDash(); renderCard(); }

  /* ---------- editing ---------- */
  function onEdit(e) {
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-check')) {
      if (e.type === 'change') { state.checks[t.getAttribute('data-check')] = t.checked; save(); }
      return;
    }
    if (!t.hasAttribute('data-b')) return;
    var b = BYID[t.getAttribute('data-b')];
    if (!b) return;
    var v = t.value;
    if (t.type === 'number') v = v === '' ? '' : num(v);
    var k = t.getAttribute('data-k');
    var row = b.kind === 'single' ? state[b.id] : state[b.id][+t.getAttribute('data-i')];
    if (!row) return;
    if (row[k] === v) return; // input+change must not cause duplicate saves
    row[k] = v;
    row._upd = todayISO();
    save();
    refresh();
    if (e.type === 'change') { var lu = document.querySelector('#b-' + b.id + ' .upd'); if (lu) lu.textContent = 'Last updated: ' + prettyDate(row._upd); }
  }

  function clearOrAdd(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var add = t.closest('[data-add]'), dup = t.closest('[data-dup]'), del = t.closest('[data-del]');
    if (add) {
      var b = BYID[add.getAttribute('data-add')];
      state[b.id].push({ _upd: todayISO() });
      save(); renderBlock(b); refresh(); return;
    }
    if (dup) {
      var b1 = BYID[dup.getAttribute('data-dup')];
      var copy = JSON.parse(JSON.stringify(state[b1.id][+dup.getAttribute('data-i')]));
      copy._upd = todayISO();
      state[b1.id].splice(+dup.getAttribute('data-i') + 1, 0, copy);
      save(); renderBlock(b1); refresh();
      status('Row duplicated. Change the name or details for the new row.');
      return;
    }
    if (del) {
      if (!dup) {
        var b2 = BYID[del.getAttribute('data-del')];
        state[b2.id].splice(+del.getAttribute('data-i'), 1);
        save(); renderBlock(b2); refresh(); return;
      }
    }
    var cb = t.closest('#clear-btn');
    if (cb) { clearAll(cb); return; }
    var bk = t.closest('#backup-btn');
    if (bk) { saveBackup(); return; }
    var cc = t.closest('#copy-card');
    if (cc) { copyCard(cc); }
  }

  var clearArmed = false, clearTimer = null;
  function clearAll(btn) {
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = 'Click again to clear everything';
      clearTimeout(clearTimer);
      clearTimer = setTimeout(function () { clearArmed = false; btn.textContent = 'Clear all'; }, 4000);
      return;
    }
    clearTimeout(clearTimer); clearArmed = false; btn.textContent = 'Clear all';
    state = blank();
    try { localStorage.removeItem(KEY); } catch (err) {}
    renderAll();
    status('All entries cleared on this device.');
  }

  function saveBackup() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    download('family-information-book-backup-' + todayISO() + '.json', blob);
    status('Backup downloaded. CAUTION: it is readable JSON containing private family information. Store securely.');
  }
  function restoreBackup(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var o = JSON.parse(r.result);
        if (!o || typeof o !== 'object') throw new Error('bad');
        state = merge(o); save(); renderAll();
        status('Backup restored.');
      } catch (err) { status('This file is not a valid backup from this book.'); }
    };
    r.readAsText(file);
  }

  /* ---------- Excel import ---------- */
  function excelDate(v) {
    if (typeof v === 'number') {
      var ms = Math.round((v - 25569) * 86400 * 1000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    var s = String(v || '').trim();
    var m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
    if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
  }
  function cellToField(f, v) {
    if (v === '' || v === null || v === undefined) return '';
    if (f.t === 'date') return excelDate(v);
    if (f.t === 'num') { var n = num(v); return isNaN(n) ? '' : n; }
    if (f.t === 'sel') {
      var hit = f.o.filter(function (o) { return o.toLowerCase() === String(v).trim().toLowerCase(); })[0];
      return hit || '';
    }
    return String(v).trim();
  }
  function importSheet(b, rows) {
    var added = 0, skipped = 0;
    if (b.kind === 'single') {
      rows.forEach(function (r) {
        var label = String(r[0] || '').trim().toLowerCase();
        var f = b.fields.filter(function (x) { return x.l.toLowerCase() === label; })[0];
        if (f && r[1] !== '' && r[1] !== undefined) state[b.id][f.k] = cellToField(f, r[1]);
      });
      if (Object.keys(state[b.id]).length) state[b.id]._upd = todayISO();
      return { added: 1, skipped: 0 };
    }
    var header = (rows[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
    var map = header.map(function (h) {
      var f = b.fields.filter(function (x) { return x.l.toLowerCase() === h || x.k.toLowerCase() === h; })[0];
      return f || null;
    });
    if (!map.some(Boolean)) return { added: 0, skipped: rows.length - 1, error: 'Headings do not match the template.' };
    rows.slice(1).forEach(function (r) {
      if (!r.some(function (c) { return c !== '' && c !== undefined; })) return;
      var row = {};
      map.forEach(function (f, i) { if (f) row[f.k] = cellToField(f, r[i]); });
      if (!Object.keys(row).some(function (k) { return row[k] !== ''; })) { skipped++; return; }
      row._upd = todayISO();
      state[b.id].push(row);
      added++;
    });
    return { added: added, skipped: skipped };
  }
  function importExcel(file) {
    if (!file) return;
    status('Reading the Excel file…');
    var r = new FileReader();
    r.onload = function () {
      XlsxReader.readWorkbook(r.result).then(function (sheets) {
        var total = 0, skipped = 0, used = [], problems = [];
        sheets.forEach(function (sh) {
          var name = sh.name.trim().toLowerCase();
          var b = BLOCKS.filter(function (x) { return x.title.toLowerCase() === name; })[0];
          if (!b || !sh.rows.length) return;
          var res = importSheet(b, sh.rows);
          if (res.error) problems.push(sh.name + ': ' + res.error);
          total += res.added; skipped += res.skipped || 0;
          if (res.added) used.push(sh.name + ' (' + res.added + ')');
        });
        save(); renderAll();
        var msg = total ? 'Imported ' + total + ' record(s): ' + used.join(', ') + '.' : 'No records were imported. Check that the sheet names and headings match the template.';
        if (skipped) msg += ' ' + skipped + ' empty row(s) skipped.';
        if (problems.length) msg += ' ' + problems.join(' ');
        status(msg);
      }).catch(function (err) { status(err.message || 'Could not read this Excel file.'); });
    };
    r.readAsArrayBuffer(file);
  }

  /* ---------- emergency card copy ---------- */
  function fallbackCopy(txt) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (err) { return false; }
  }
  function copyCard(btn) {
    var el = document.getElementById('card');
    var txt = el ? el.innerText : '';
    function show(ok) {
      btn.textContent = ok ? 'Copied' : 'Select the card and copy';
      setTimeout(function () { btn.textContent = 'Copy emergency card'; }, 2200);
    }
    try {
      navigator.clipboard.writeText(txt).then(function () { show(true); }, function () { show(fallbackCopy(txt)); });
    } catch (err) { show(fallbackCopy(txt)); }
  }

  /* ---------- install and offline ---------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferredPrompt = e;
    var b = document.getElementById('install-btn'); if (b) b.hidden = false;
  });
  window.addEventListener('appinstalled', function () {
    var b = document.getElementById('install-btn'); if (b) b.hidden = true;
  });
  function wireInstall() {
    var b = document.getElementById('install-btn');
    if (!b) return;
    b.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt = null; b.hidden = true;
    });
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var ok = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!ok) return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* ---------- start ---------- */
  build();
  var versionEl = document.getElementById('build-version');
  if (versionEl) versionEl.textContent = window.CloudSync && CloudSync.version
    ? 'Build ' + CloudSync.version
    : 'Code version mismatch — reload when online';
  wireInstall();
  registerSW();
  if (window.CloudSync) {
    CloudSync.start({
      render: renderAll,
      setState: function (s) { state = merge(s); },
      // If a form field has focus, a background refresh must NOT recreate it.
      isEditing: function () {
        var active = document.activeElement;
        return !!(active && active.hasAttribute &&
          (active.hasAttribute('data-b') || active.hasAttribute('data-check')));
      }
    });
  } else {
    renderAll();
  }

  document.addEventListener('input', onEdit);
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'xlsx-file') { importExcel(e.target.files[0]); e.target.value = ''; return; }
    if (e.target && e.target.id === 'backup-file') { restoreBackup(e.target.files[0]); e.target.value = ''; return; }
    onEdit(e);
  });
  document.addEventListener('click', clearOrAdd);
})();
