/* Family sign-in and sync through a Google Apps Script web app (Code.gs), which keeps its data in a Google Sheet.
   Section data is encrypted in this browser with the family passphrase before it is sent, so the sheet only holds scrambled text.
   Active only when config.js holds the Web app URL. Without it the app runs on this device only. */
(function (global) {
  'use strict';
  var cfg = global.APP_CONFIG || {};
  var SESSION_KEY = 'fib-session', CACHE_KEY = 'fib-cache';
  var KEYCHECK = 'keycheck', CHECK_TEXT = 'family-book-check', PBKDF2_ITER = 200000;
  var api = { configured: !!cfg.APPS_SCRIPT_URL, active: false, start: null, push: null, refresh: null };
  global.CloudSync = api;

  var token = null, user = null, family = null, myRole = null, members = [], requests = [];
  var opts = null, lastSynced = {}, baseTimes = {}, pushTimer = null, pendingState = null, retryTimer = null, pendingEmail = '';
  var keyObj = null, pendingOpen = null;

  var PRIVACY = 'Your family’s records are encrypted on your device with the family passphrase. The Google Sheet holds only scrambled text, and the app owner cannot read the records without that passphrase. ' +
    'The app owner can see account emails and names, who is in which family, and when records were last saved. You can leave a family or delete your account at any time.';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function syncMsg(text, isErr) {
    var el = $('status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isErr ? 'var(--danger)' : '';
  }
  function blankState() {
    var s = { checks: {} };
    BLOCKS.forEach(function (b) { s[b.id] = b.kind === 'single' ? {} : []; });
    return s;
  }
  function validShape(b, v) {
    return b.kind === 'single' ? (v && typeof v === 'object' && !Array.isArray(v)) : Array.isArray(v);
  }
  function snapshot(s) {
    var out = {};
    BLOCKS.forEach(function (b) { out[b.id] = JSON.stringify(s[b.id]); });
    out.checks = JSON.stringify(s.checks || {});
    return out;
  }
  function buildState(data) {
    var s = blankState();
    Object.keys(data || {}).forEach(function (id) {
      if (id === 'checks') { if (data.checks && typeof data.checks === 'object') s.checks = data.checks; return; }
      var b = BLOCKS.filter(function (x) { return x.id === id; })[0];
      if (b && validShape(b, data[id])) s[id] = data[id];
    });
    return s;
  }
  function writeCache(s) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) {} }
  function readCache() { try { var r = localStorage.getItem(CACHE_KEY); return r ? buildState(JSON.parse(r)) : null; } catch (e) { return null; } }
  function saveToken(t) { token = t; try { if (t) localStorage.setItem(SESSION_KEY, t); else localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function passKey(fid) { return 'fib-key:' + fid; }
  function readPass(fid) { try { return localStorage.getItem(passKey(fid)) || ''; } catch (e) { return ''; } }
  function storePass(fid, p) { try { localStorage.setItem(passKey(fid), p); } catch (e) {} }
  function clearPass(fid) { try { localStorage.removeItem(passKey(fid)); } catch (e) {} }
  function clearLocal() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    if (family) clearPass(family.id);
    keyObj = null; pendingOpen = null; pendingState = null;
  }

  /* ---------- encryption (runs in the browser; the server never sees the passphrase or the key) ---------- */
  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function deriveKey(pass, familyId) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('family-book-v1:' + familyId), iterations: PBKDF2_ITER },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealValue(key, value) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var pt = new TextEncoder().encode(JSON.stringify(value));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, pt);
    return { enc: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function openValue(key, env) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  // Decrypts every section. Sections saved before encryption existed are plain and get re-saved encrypted.
  async function decryptAll(data, key) {
    var out = {}, legacy = false;
    for (var id of Object.keys(data || {})) {
      if (id === KEYCHECK) continue;
      var v = data[id];
      if (v && v.enc === 1) out[id] = await openValue(key, v);
      else { out[id] = v; legacy = true; }
    }
    return { data: out, legacy: legacy };
  }
  // True if the family passphrase we hold still matches the family's check value.
  async function keyStillValid(g) {
    var kc = g.data && g.data[KEYCHECK];
    if (!kc || kc.enc !== 1) return true;
    try { return (await openValue(keyObj, kc)) === CHECK_TEXT; } catch (e) { return false; }
  }

  // Sign-in key: derived in the browser from the password, so the password itself is never sent.
  async function authKey(password, email) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('family-book-auth-v2:' + String(email).trim().toLowerCase()), iterations: 310000 },
      base, 256);
    return b64(new Uint8Array(bits));
  }

  function downloadJson(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- talking to the server ---------- */
  function call(action, body) {
    var payload = Object.assign({ action: action }, body || {});
    if (token) payload.token = token;
    return fetch(cfg.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }, function () {
      var e = new Error('Could not reach the family service. Check your internet connection.');
      e.network = true; throw e;
    }).then(function (j) {
      if (!j || !j.ok) {
        var e = new Error((j && j.error) || 'Something went wrong. Please try again.');
        e.needsConfirm = !!(j && j.needsConfirm);
        e.conflict = !!(j && j.conflict);
        e.signedOut = /sign in again/i.test(e.message);
        throw e;
      }
      return j;
    });
  }

  /* ---------- screens ---------- */
  function showAuth(mode, message) {
    var box = $('cloud-auth');
    if (!box) return;
    var isUp = mode === 'signup';
    var titles = { reset: 'Reset password', recover: 'Enter the code and a new password', confirm: 'Enter your confirmation code' };
    var html = '<div class="auth-card"><h2>Family Information Book</h2>';
    if (mode === 'signin' || mode === 'signup') {
      html += '<p class="hint">Sign in to open your family’s book.</p>' +
        '<div class="auth-tabs"><button type="button" data-act="mode" data-mode="signin" class="' + (!isUp ? 'on' : '') + '">Sign in</button>' +
        '<button type="button" data-act="mode" data-mode="signup" class="' + (isUp ? 'on' : '') + '">Create account</button></div>';
    } else {
      html += '<h3>' + esc(titles[mode] || '') + '</h3>';
    }
    html += '<form id="auth-form" novalidate data-mode="' + mode + '">';
    if (isUp) html += '<label class="fld"><span>Your full name</span><input name="name" autocomplete="name" required maxlength="80"></label>';
    if (mode === 'recover' || mode === 'confirm') {
      html += '<p class="hint">We sent a code to <b>' + esc(pendingEmail) + '</b>. It is valid for 15 minutes.</p>' +
        '<label class="fld"><span>6-digit code from the email</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="8" required></label>';
    } else {
      html += '<label class="fld"><span>Email</span><input name="email" type="email" autocomplete="email" value="' + esc(pendingEmail) + '" required></label>';
    }
    if (mode === 'signin' || mode === 'signup') html += '<label class="fld"><span>Password (at least 8 characters)</span><input name="password" type="password" autocomplete="' + (isUp ? 'new-password' : 'current-password') + '" minlength="8" required></label>';
    if (mode === 'recover') html += '<label class="fld"><span>New password (at least 8 characters)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>';
    var go = { signin: 'Sign in', signup: 'Create account', reset: 'Send code', recover: 'Save new password', confirm: 'Confirm' }[mode];
    html += '<button type="submit" class="auth-go">' + go + '</button></form>';
    if (mode === 'signin') html += '<p class="auth-links"><a href="#" data-act="mode" data-mode="reset">Forgot password?</a></p>';
    if (mode === 'reset' || mode === 'recover') html += '<p class="auth-links"><a href="#" data-act="mode" data-mode="signin">Back to sign in</a></p>';
    if (mode === 'recover' || mode === 'confirm') html += '<p class="auth-links"><a href="#" data-act="resend" data-mode="' + mode + '">Send a new code</a> · <a href="#" data-act="mode" data-mode="signin">Back to sign in</a></p>';
    html += '<p id="auth-msg" class="auth-msg" role="status">' + esc(message || '') + '</p>';
    html += '<p class="hint" style="margin-top:14px;font-size:12px">' + esc(PRIVACY) + '</p></div>';
    box.innerHTML = html;
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function showFamilySetup() {
    var box = $('cloud-auth');
    box.innerHTML = '<div class="auth-card"><h2>Set up your family</h2>' +
      '<p class="hint">Signed in as <b>' + esc(user && user.email) + '</b>. Create a new family book, or ask to join one. The family admin must approve your request.</p>' +
      '<form id="create-form" class="setup-form"><h3>Create a new family</h3>' +
      '<label class="fld"><span>Family name (for example, Sharma family)</span><input name="fname" required maxlength="80"></label>' +
      '<button type="submit" class="auth-go">Create family</button></form>' +
      '<form id="join-form" class="setup-form"><h3>Ask to join a family</h3>' +
      '<label class="fld"><span>Family code from your admin</span><input name="code" required maxlength="12" autocapitalize="characters"></label>' +
      '<button type="submit" class="auth-go ghost">Send request</button></form>' +
      '<p class="auth-links"><a href="#" data-act="signout">Sign out</a></p>' +
      '<p id="auth-msg" class="auth-msg" role="status"></p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function showPending(name) {
    var box = $('cloud-auth');
    box.innerHTML = '<div class="auth-card"><h2>Waiting for approval</h2>' +
      '<p class="hint">Your request to join <b>' + esc(name) + '</b> was sent to the family admin. You can open the book once they approve it.</p>' +
      '<button type="button" class="auth-go" data-act="recheck">Check again</button>' +
      '<p class="auth-links"><a href="#" data-act="signout">Sign out</a></p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  // Asks for the family passphrase. The admin sets it once; everyone else enters it.
  function showKeyScreen(g, note) {
    var box = $('cloud-auth');
    if (!box) return;
    var hasCheck = !!(g.data && g.data[KEYCHECK] && g.data[KEYCHECK].enc === 1);
    var inner;
    if (!hasCheck && myRole !== 'admin') {
      inner = '<p class="hint">The family admin needs to sign in once to set the family passphrase. After that, you can open the book with it.</p>';
    } else if (!hasCheck) {
      inner = '<h3>Set the family passphrase</h3>' +
        '<p class="hint">This passphrase locks your family’s records. Share it with every family member, in person. If it is lost, the records cannot be recovered.</p>' +
        '<form id="key-form" data-mode="create" novalidate>' +
        '<label class="fld"><span>Family passphrase (at least 8 characters)</span><input name="pass" type="password" autocomplete="new-password" minlength="8" required></label>' +
        '<label class="fld"><span>Type it again</span><input name="pass2" type="password" autocomplete="new-password" minlength="8" required></label>' +
        '<button type="submit" class="auth-go">Save passphrase</button></form>';
    } else {
      inner = '<h3>Enter the family passphrase</h3>' +
        '<p class="hint">Ask your family admin for the passphrase. It is kept only on this device until you sign out.</p>' +
        '<form id="key-form" data-mode="enter" novalidate>' +
        '<label class="fld"><span>Family passphrase</span><input name="pass" type="password" autocomplete="off" required></label>' +
        '<button type="submit" class="auth-go">Unlock</button></form>';
    }
    box.innerHTML = '<div class="auth-card"><h2>Family passphrase</h2>' + inner +
      '<p class="auth-links"><a href="#" data-act="signout">Sign out</a></p>' +
      '<p id="auth-msg" class="auth-msg" role="status">' + esc(note || '') + '</p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function showChangePass() {
    var box = $('cloud-auth');
    box.innerHTML = '<div class="auth-card"><h2>Change the family passphrase</h2>' +
      '<p class="hint">Every section is re-encrypted with the new passphrase. Keep this page open until it finishes. Other members will be asked for the new passphrase on their next visit. Save a backup first if you can.</p>' +
      '<form id="changepass-form" novalidate>' +
      '<label class="fld"><span>Current passphrase</span><input name="oldp" type="password" autocomplete="off" required></label>' +
      '<label class="fld"><span>New passphrase (at least 8 characters)</span><input name="newp" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<label class="fld"><span>Type the new passphrase again</span><input name="newp2" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<button type="submit" class="auth-go">Change passphrase</button></form>' +
      '<p class="auth-links"><a href="#" data-act="back">Cancel</a></p>' +
      '<p id="auth-msg" class="auth-msg" role="status"></p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function showDeleteAccount() {
    var box = $('cloud-auth');
    box.innerHTML = '<div class="auth-card"><h2>Delete your account</h2>' +
      '<p class="hint">Your sign-in and your membership are removed. If you are the last member of a family, the family’s book is deleted too. Other families are not affected. This cannot be undone.</p>' +
      '<form id="delete-form" novalidate>' +
      '<label class="fld"><span>Your password</span><input name="pass" type="password" autocomplete="current-password" required></label>' +
      '<button type="submit" class="auth-go danger">Delete my account</button></form>' +
      '<p class="auth-links"><a href="#" data-act="back">Cancel</a></p>' +
      '<p id="auth-msg" class="auth-msg" role="status"></p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function hideAuth() { var box = $('cloud-auth'); if (box) { box.hidden = true; box.innerHTML = ''; } }

  function showBar() {
    var bar = $('cloud-bar');
    if (!bar || !family) return;
    var isAdmin = myRole === 'admin';
    var list = members.map(function (m) {
      var acts = '';
      if (isAdmin && !m.me) {
        acts += ' <button type="button" class="row-act" data-act="makeadmin" data-email="' + esc(m.email) + '">Make admin</button>';
        acts += ' <button type="button" class="row-act del" data-act="remove" data-email="' + esc(m.email) + '">Remove</button>';
      }
      return '<li>' + esc(m.name) + (m.me ? ' (you)' : '') + ' <small>' + (m.role === 'admin' ? 'admin' : 'member') + '</small>' + acts + '</li>';
    }).join('');
    var reqs = '';
    if (isAdmin) {
      reqs = requests.length
        ? '<p class="hint"><b>Join requests</b></p><ul class="members">' + requests.map(function (r) {
            return '<li>' + esc(r.name) + ' <small>' + esc(r.email) + '</small> ' +
              '<button type="button" class="row-act" data-act="approve" data-id="' + esc(r.id) + '">Approve</button> ' +
              '<button type="button" class="row-act del" data-act="reject" data-id="' + esc(r.id) + '">Reject</button></li>';
          }).join('') + '</ul>'
        : '<p class="hint">No join requests waiting.</p>';
    }
    bar.innerHTML = '<div class="cloud-row"><div><b>' + esc(family.name) + '</b> <small>· ' + esc(user && user.email) + ' (' + (isAdmin ? 'admin' : 'member') + ')</small></div>' +
      '<div class="cloud-actions">' +
      '<details><summary>Members (' + members.length + ')</summary><ul class="members">' + list + '</ul>' +
      (isAdmin ? '<p class="hint">Family code: <b class="code">' + esc(family.join_code) + '</b> <button type="button" class="row-act" data-act="newcode">New code</button></p>' + reqs : '') +
      '</details>' +
      '<button type="button" class="row-act" data-act="refresh">Refresh</button>' +
      (isAdmin ? '<button type="button" class="row-act" data-act="changepass">Change passphrase</button>' : '') +
      '<button type="button" class="row-act" data-act="leave">Leave family</button>' +
      '<button type="button" class="row-act del" data-act="delacct">Delete account</button>' +
      '<button type="button" class="row-act" data-act="signout">Sign out</button></div></div>' +
      '<p class="hint" style="font-size:12px">' + esc(PRIVACY) + '</p>';
    bar.hidden = false;
    var clear = $('clear-btn'); if (clear) clear.hidden = true;
  }

  /* ---------- opening a family ---------- */
  async function openFamily() {
    try {
      var me = await call('me');
      user = me.user;
      if (me.pending) { family = null; showPending(me.pending); return; }
      if (!me.family) { family = null; showFamilySetup(); return; }
      var g = await call('getFamily');
      family = g.family; myRole = g.role; members = g.members || []; requests = g.requests || [];
      pendingOpen = g;
      var saved = readPass(family.id);
      if (saved) {
        try { await unlock(saved, g); return; }
        catch (e) { if (/not correct/.test(e.message)) clearPass(family.id); }
      }
      showKeyScreen(g);
    } catch (err) {
      if (err.signedOut) { saveToken(null); showAuth('signin', 'Please sign in again.'); return; }
      var cached = readCache();
      if (cached && family && keyObj) { finishOpen(cached, 'Offline: showing the last saved copy on this device.'); return; }
      showAuth('signin', err.message);
    }
  }

  function finishOpen(s, note) {
    api.active = true;
    opts.setState(s);
    hideAuth();
    showBar();
    opts.render();
    syncMsg(note || 'Signed in. Changes save automatically.', !!note);
  }

  // Checks the passphrase against the family check value, then loads the book.
  async function unlock(pass, g) {
    var key = await deriveKey(pass, family.id);
    var kc = g.data && g.data[KEYCHECK];
    if (!kc || kc.enc !== 1) throw new Error('The family admin needs to sign in once to set the family passphrase.');
    var check = null;
    try { check = await openValue(key, kc); } catch (e) { check = null; }
    if (check !== CHECK_TEXT) throw new Error('That passphrase is not correct for this family.');
    var res = await decryptAll(g.data, key);
    keyObj = key;
    storePass(family.id, pass);
    var s = buildState(res.data);
    baseTimes = g.times || {};
    lastSynced = res.legacy ? {} : snapshot(s);
    writeCache(s);
    finishOpen(s, '');
    if (res.legacy) api.push(s);
  }

  // Admin sets the passphrase for the first time.
  async function createPassphrase(pass, g) {
    var key = await deriveKey(pass, family.id);
    var env = await sealValue(key, CHECK_TEXT);
    var res = await call('saveBlock', { blockId: KEYCHECK, data: env, baseUpdatedAt: baseTimes[KEYCHECK] || 0 });
    baseTimes[KEYCHECK] = res.savedAt;
    g.data = g.data || {};
    g.data[KEYCHECK] = env;
    await unlock(pass, g);
  }

  // The passphrase was changed by the admin: forget the old one and ask for the new one.
  function lockForNewPassphrase(g) {
    clearPass(family.id);
    keyObj = null; pendingState = null;
    pendingOpen = g;
    showKeyScreen(g, 'The family passphrase was changed by the admin. Enter the new passphrase. Changes you made just now were not saved.');
  }

  /* ---------- saving ---------- */
  api.push = function (s) {
    if (!api.active || !keyObj) return;
    pendingState = s;
    writeCache(s);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 500);
  };

  async function flush() {
    if (!pendingState || !api.active || !keyObj) return;
    var s = pendingState, snap = snapshot(s);
    var changed = BLOCKS.map(function (b) { return b.id; }).concat(['checks']).filter(function (id) { return snap[id] !== lastSynced[id]; });
    if (!changed.length) { pendingState = null; return; }
    try {
      var g = await call('getFamily');
      if (!(await keyStillValid(g))) { lockForNewPassphrase(g); return; }
      for (var i = 0; i < changed.length; i++) {
        var id = changed[i];
        var env = await sealValue(keyObj, JSON.parse(snap[id]));
        var res = await call('saveBlock', { blockId: id, data: env, baseUpdatedAt: baseTimes[id] || 0 });
        lastSynced[id] = snap[id];
        baseTimes[id] = res.savedAt;
      }
      if (pendingState === s) pendingState = null;
      syncMsg('All changes saved at ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + '.');
    } catch (err) {
      if (err.conflict) { takeLatest(err.message); return; }
      syncMsg(err.message + ' Your changes are kept and will be saved when it works again.', true);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, 15000);
    }
  }

  // Someone else saved first: show their version and do not overwrite it.
  async function takeLatest(message) {
    pendingState = null;
    clearTimeout(retryTimer);
    try { await api.refresh(); } catch (e) {}
    syncMsg(message, true);
  }

  api.refresh = async function () {
    if (!api.active || !keyObj) return;
    // Save anything still waiting first, so Refresh never silently does nothing.
    if (pendingState) { clearTimeout(pushTimer); await flush(); if (pendingState) return; }
    try {
      var g = await call('getFamily');
      family = g.family; myRole = g.role; members = g.members || []; requests = g.requests || [];
      if (!(await keyStillValid(g))) { lockForNewPassphrase(g); return; }
      var res = await decryptAll(g.data, keyObj);
      var s = buildState(res.data);
      lastSynced = snapshot(s); baseTimes = g.times || {};
      writeCache(s);
      opts.setState(s); opts.render(); showBar();
      syncMsg('Up to date.');
    } catch (err) { syncMsg(err.message, true); }
  };

  async function signOut() {
    try { await call('logout'); } catch (e) {}
    if (family) clearPass(family.id);
    saveToken(null);
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    user = null; family = null; members = []; requests = []; api.active = false; pendingState = null;
    keyObj = null; pendingOpen = null;
    opts.setState(blankState()); opts.render();
    var clear = $('clear-btn'); if (clear) clear.hidden = false;
    showAuth('signin');
  }

  /* ---------- forms ---------- */
  function fieldVal(form, name) { return String(form.elements[name].value || '').trim(); }

  async function handleAuth(form) {
    var mode = form.dataset.mode;
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    msg('Please wait…');
    try {
      if (mode === 'confirm') {
        var c = await call('confirm', { email: pendingEmail, code: fieldVal(form, 'code') });
        saveToken(c.token); openFamily(); return;
      }
      if (mode === 'recover') {
        var newPw = form.elements.password.value;
        if (newPw.length < 8) { msg('Password must be at least 8 characters.'); return; }
        var r = await call('resetPassword', { email: pendingEmail, code: fieldVal(form, 'code'), auth: await authKey(newPw, pendingEmail) });
        saveToken(r.token); openFamily(); return;
      }
      var email = fieldVal(form, 'email');
      if (email) pendingEmail = email;
      if (mode === 'reset') {
        await call('requestReset', { email: email });
        showAuth('recover', 'If this email has an account, a code has been sent. Enter it below.');
        return;
      }
      var password = form.elements.password.value;
      if (password.length < 8) { msg('Password must be at least 8 characters.'); return; }
      if (mode === 'signup') {
        var name = fieldVal(form, 'name');
        var su = await call('signup', { email: email, name: name, auth: await authKey(password, email) });
        if (su.needsConfirm) { showAuth('confirm', 'Account created. Enter the code we emailed you to finish.'); }
        return;
      }
      var si = await call('login', { email: email, auth: await authKey(password, email) });
      saveToken(si.token); openFamily();
    } catch (err) {
      if (err.needsConfirm) { showAuth('confirm', err.message); return; }
      msg(err.message);
    }
  }

  async function handleSetup(form, kind) {
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    msg('Please wait…');
    try {
      if (kind === 'create') await call('createFamily', { name: fieldVal(form, 'fname') });
      else await call('joinFamily', { code: fieldVal(form, 'code') });
      openFamily();
    } catch (err) { msg(err.message); }
  }

  async function handleKey(form) {
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    var mode = form.dataset.mode, pass = form.elements.pass.value;
    if (pass.length < 8) { msg('Use at least 8 characters.'); return; }
    if (mode === 'create' && form.elements.pass2.value !== pass) { msg('The two passphrases do not match.'); return; }
    msg('Please wait…');
    try {
      if (mode === 'create') await createPassphrase(pass, pendingOpen);
      else await unlock(pass, pendingOpen);
    } catch (err) { msg(err.message); }
  }

  async function handleChangePass(form) {
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    var oldP = form.elements.oldp.value, newP = form.elements.newp.value, newP2 = form.elements.newp2.value;
    if (newP.length < 8) { msg('Use at least 8 characters for the new passphrase.'); return; }
    if (newP !== newP2) { msg('The two new passphrases do not match.'); return; }
    if (newP === oldP) { msg('Choose a different passphrase.'); return; }
    msg('Please wait. Keep this page open…');
    try {
      var g = await call('getFamily');
      var oldKey = await deriveKey(oldP, family.id);
      var kc = g.data[KEYCHECK], check = null;
      try { check = await openValue(oldKey, kc); } catch (e) { check = null; }
      if (check !== CHECK_TEXT) throw new Error('The current passphrase is not correct.');
      var res = await decryptAll(g.data, oldKey);
      var state = buildState(res.data);
      // Keep a copy on the device in case something goes wrong part way.
      downloadJson('family-book-before-passphrase-change.json', state);
      var newKey = await deriveKey(newP, family.id);
      var times = Object.assign({}, g.times || {});
      var ids = BLOCKS.map(function (b) { return b.id; }).concat(['checks']);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var env = await sealValue(newKey, state[id]);
        var r = await call('saveBlock', { blockId: id, data: env, baseUpdatedAt: times[id] || 0 });
        times[id] = r.savedAt;
      }
      // The check value is written last, so the new passphrase only takes effect when everything is saved.
      var checkEnv = await sealValue(newKey, CHECK_TEXT);
      var rc = await call('saveBlock', { blockId: KEYCHECK, data: checkEnv, baseUpdatedAt: times[KEYCHECK] || 0 });
      times[KEYCHECK] = rc.savedAt;
      keyObj = newKey;
      storePass(family.id, newP);
      baseTimes = times;
      lastSynced = snapshot(state);
      writeCache(state);
      hideAuth(); showBar();
      syncMsg('Passphrase changed. Other members will be asked for the new one.');
    } catch (err) {
      msg(err.message + ' If this keeps happening, use Restore backup with the file that was downloaded.');
    }
  }

  async function handleDelete(form) {
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    var pw = form.elements.pass.value;
    if (pw.length < 8) { msg('Enter your password.'); return; }
    msg('Please wait…');
    try {
      await call('deleteAccount', { auth: await authKey(pw, user.email) });
      clearLocal();
      saveToken(null);
      user = null; family = null; members = []; requests = []; api.active = false;
      opts.setState(blankState()); opts.render();
      var clear = $('clear-btn'); if (clear) clear.hidden = false;
      showAuth('signin', 'Your account has been deleted.');
    } catch (err) { msg(err.message); }
  }

  document.addEventListener('submit', function (e) {
    if (!api.configured) return;
    var f = e.target;
    if (f.id === 'auth-form') { e.preventDefault(); handleAuth(f); }
    if (f.id === 'create-form') { e.preventDefault(); handleSetup(f, 'create'); }
    if (f.id === 'join-form') { e.preventDefault(); handleSetup(f, 'join'); }
    if (f.id === 'key-form') { e.preventDefault(); handleKey(f); }
    if (f.id === 'changepass-form') { e.preventDefault(); handleChangePass(f); }
    if (f.id === 'delete-form') { e.preventDefault(); handleDelete(f); }
  });

  async function decide(id, decision) {
    try { await call('decideRequest', { requestId: id, decision: decision }); syncMsg(decision === 'approve' ? 'Approved.' : 'Rejected.'); }
    catch (err) { syncMsg(err.message, true); }
    api.refresh();
  }

  document.addEventListener('click', async function (e) {
    if (!api.configured) return;
    var t = e.target.closest && e.target.closest('[data-act]');
    if (!t) return;
    e.preventDefault();
    var act = t.getAttribute('data-act');
    if (act === 'mode') { showAuth(t.getAttribute('data-mode')); return; }
    if (act === 'signout') { signOut(); return; }
    if (act === 'recheck') { openFamily(); return; }
    if (act === 'back') { openFamily(); return; }
    if (act === 'refresh') { api.refresh(); return; }
    if (act === 'resend') {
      var rmode = t.getAttribute('data-mode');
      try { await call('resend', { email: pendingEmail, purpose: rmode === 'confirm' ? 'signup' : 'reset' }); } catch (err) {}
      var m2 = $('auth-msg'); if (m2) m2.textContent = 'A new code has been sent if this email is registered.';
      return;
    }
    if (act === 'newcode') {
      try { var nc = await call('newCode'); family.join_code = nc.join_code; showBar(); syncMsg('New family code created. Share it only with new members.'); }
      catch (err) { syncMsg(err.message, true); }
      return;
    }
    if (act === 'approve') { decide(t.getAttribute('data-id'), 'approve'); return; }
    if (act === 'reject') { decide(t.getAttribute('data-id'), 'reject'); return; }
    if (act === 'remove') {
      if (!confirm('Remove this member from the family? They will no longer see its data.')) return;
      try { await call('removeMember', { email: t.getAttribute('data-email') }); api.refresh(); }
      catch (err) { syncMsg(err.message, true); }
      return;
    }
    if (act === 'makeadmin') {
      if (!confirm('Make this member the family admin? You will become an ordinary member.')) return;
      try { await call('transferAdmin', { email: t.getAttribute('data-email') }); syncMsg('Admin role handed over.'); }
      catch (err) { syncMsg(err.message, true); }
      api.refresh();
      return;
    }
    if (act === 'leave') {
      if (!confirm('Leave this family? You will lose access to its book on this device. If you are the last member, the family and its data are deleted.')) return;
      try {
        await call('leaveFamily');
        clearLocal();
        family = null; members = []; requests = []; myRole = null;
        opts.setState(blankState()); opts.render();
        openFamily();
      } catch (err) { syncMsg(err.message, true); }
      return;
    }
    if (act === 'changepass') { showChangePass(); return; }
    if (act === 'delacct') { showDeleteAccount(); return; }
  });

  /* ---------- start ---------- */
  api.start = function (o) {
    opts = o;
    if (!api.configured) { o.render(); return; }
    o.render();
    window.addEventListener('online', function () { if (pendingState) flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') api.refresh();
    });
    try { token = localStorage.getItem(SESSION_KEY); } catch (e) { token = null; }
    if (token) openFamily();
    else showAuth('signin');
  };

  // Used by tests only.
  api._crypto = { authKey: authKey, deriveKey: deriveKey, sealValue: sealValue, openValue: openValue, decryptAll: decryptAll, KEYCHECK: KEYCHECK, CHECK_TEXT: CHECK_TEXT };
})(typeof window !== 'undefined' ? window : globalThis);
