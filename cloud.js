/* Family sign-in and sync through a Google Apps Script web app (Code.gs), which keeps its data in a Google Sheet.
   Section data is encrypted in this browser with the family passphrase before it is sent, so the sheet only holds scrambled text.
   Active only when config.js holds the Web app URL. Without it the app runs on this device only. */
(function (global) {
  'use strict';
  var cfg = global.APP_CONFIG || {};
  var SESSION_KEY = 'fib-session', CACHE_KEY = 'fib-cache', DRAFT_PREFIX = 'fib-draft-v10:';
  var KEYCHECK = 'keycheck', RECOVERY = 'recovery', CHECK_TEXT = 'family-book-check', PBKDF2_ITER = 200000;
  var MIN_PASS = 8, MIN_PASSWORD = 8;
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var api = { configured: !!cfg.APPS_SCRIPT_URL, active: false, start: null, push: null, refresh: null, version: 'v12-family-excel' };
  global.CloudSync = api;

  var token = null, user = null, family = null, myRole = null, members = [], requests = [];
  var opts = null, lastSynced = {}, baseTimes = {}, pushTimer = null, pendingState = null, retryTimer = null, pendingEmail = '';
  var keyObj = null, pendingOpen = null;
  var activeFlush = null, editRevision = 0, draftPromise = Promise.resolve(), draftOk = true;
  var conflictingCopy = null;

  var PRIVACY = 'Your family’s records are encrypted on your device with the family passphrase. The Google Sheet holds only scrambled text, and the app owner cannot read the records without that passphrase. ' +
    'The app owner can see account emails and names, who is in which family, and when records were last saved. Unsynced edits are kept as an encrypted browser draft. Keep a separate safe backup; browser storage can be cleared or lost.';

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
  // Old versions stored a readable cache and even remembered the passphrase.
  // These are read ONLY for migration; version 10 never creates either one.
  function readCache() { try { var r = localStorage.getItem(CACHE_KEY); return r ? buildState(JSON.parse(r)) : null; } catch (e) { return null; } }
  function saveToken(t) { token = t; try { if (t) localStorage.setItem(SESSION_KEY, t); else localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function passKey(fid) { return 'fib-key:' + fid; }
  function readPass(fid) { try { return localStorage.getItem(passKey(fid)) || ''; } catch (e) { return ''; } }
  function storePass(fid, p) { clearPass(fid); } // Never save the encryption passphrase on the device.
  function clearPass(fid) { try { localStorage.removeItem(passKey(fid)); } catch (e) {} }
  function draftKey(fid) { return DRAFT_PREFIX + fid; }
  function cloneState(s) { return buildState(JSON.parse(JSON.stringify(s))); }
  function sameState(a, b) { return JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b)); }
  function removeLegacySecrets() {
    // Only after a family is unlocked and its encrypted draft is safely written (or cloud is complete).
    if (family) clearPass(family.id);
  }
  function clearLocal() {
    if (family) clearPass(family.id);
    keyObj = null; pendingOpen = null; pendingState = null; conflictingCopy = null;
  }
  function setSaveMessage(message, warning) {
    syncMsg(message, !!warning);
  }
  // AES-GCM encrypts a FULL, consistent snapshot. Never store family data as readable JSON.
  function persistDraft(s) {
    if (!family || !keyObj) return Promise.resolve(false);
    var seq = editRevision, fid = family.id, key = keyObj;
    var copy = cloneState(s);
    var meta = { v: 10, familyId: fid, revision: seq, baseTimes: Object.assign({}, baseTimes), lastSynced: Object.assign({}, lastSynced) };
    var work = sealValue(key, copy).then(function (envelope) {
      if (!family || family.id !== fid || seq !== editRevision) return false;
      meta.envelope = envelope;
      try { localStorage.setItem(draftKey(fid), JSON.stringify(meta)); draftOk = true; return true; }
      catch (err) { draftOk = false; setSaveMessage('Could not protect a local copy. Keep this page open and check your device storage.', true); return false; }
    }).catch(function () {
      draftOk = false;
      setSaveMessage('Could not encrypt a local copy. Keep this page open.', true);
      return false;
    });
    draftPromise = work;
    return work;
  }
  async function loadDraft(fid, key) {
    try {
      var raw = localStorage.getItem(draftKey(fid));
      if (!raw) return null;
      var stored = JSON.parse(raw);
      if (stored.v !== 10 || stored.familyId !== fid || !stored.envelope || stored.envelope.enc !== 1) return null;
      var state = buildState(await openValue(key, stored.envelope));
      return { state: state, baseTimes: stored.baseTimes || {}, lastSynced: stored.lastSynced || {} };
    } catch (err) {
      setSaveMessage('A saved local draft exists but could not be opened. Do not clear browser storage.', true);
      return null;
    }
  }
  function clearDraft(fid) {
    try { localStorage.removeItem(draftKey(fid)); } catch (e) {}
  }
  function hasPending() { return !!pendingState || !!activeFlush || !!conflictingCopy; }

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
      if (id === KEYCHECK || id === RECOVERY) continue;
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

  /* ---------- recovery code ----------
     A random 16-character code, shown once. The family passphrase is stored encrypted under this code,
     so the code can unlock the book if the passphrase is forgotten. The code itself is never stored. */
  function newRecoveryCode() {
    var bytes = crypto.getRandomValues(new Uint8Array(16)), out = '';
    for (var i = 0; i < 16; i++) out += CODE_CHARS.charAt(bytes[i] & 31); // 32 characters, so no bias
    return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12) + '-' + out.slice(12, 16);
  }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function recoveryKey(code, familyId) { return deriveKey(normCode(code), familyId + ':recovery'); }
  async function sealRecovery(code, pass, familyId) {
    var key = await recoveryKey(code, familyId);
    return sealValue(key, { p: pass });
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
        '<p class="hint">This passphrase locks your family’s records. Share it with every family member, in person. You will also get a recovery code, so you can get back in if the passphrase is forgotten.</p>' +
        '<form id="key-form" data-mode="create" novalidate>' +
        '<label class="fld"><span>Family passphrase (at least ' + MIN_PASS + ' characters)</span><input name="pass" type="password" autocomplete="new-password" minlength="' + MIN_PASS + '" required></label>' +
        '<label class="fld"><span>Type it again</span><input name="pass2" type="password" autocomplete="new-password" minlength="' + MIN_PASS + '" required></label>' +
        '<button type="submit" class="auth-go">Save passphrase</button></form>';
    } else {
      inner = '<h3>Enter the family passphrase</h3>' +
        '<p class="hint">Ask the family admin for this passphrase. It is not saved in your browser. Enter it again when you reopen the app.</p>' +
        '<form id="key-form" data-mode="enter" novalidate>' +
        '<label class="fld"><span>Family passphrase</span><input name="pass" type="password" autocomplete="off" required></label>' +
        '<button type="submit" class="auth-go">Unlock</button></form>' +
        '<p class="auth-links"><a href="#" data-act="recovery">Forgot the passphrase? Use the recovery code</a></p>';
    }
    box.innerHTML = '<div class="auth-card"><h2>Family passphrase</h2>' + inner +
      '<p class="auth-links"><a href="#" data-act="signout">Sign out</a></p>' +
      '<p id="auth-msg" class="auth-msg" role="status">' + esc(note || '') + '</p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  // Shows the recovery code once. The family must confirm they saved it before the book opens.
  var pendingNext = null;
  function showRecoveryCode(code, next) {
    var box = $('cloud-auth');
    pendingNext = next;
    box.innerHTML = '<div class="auth-card"><h2>Save your recovery code</h2>' +
      '<p class="hint">If the family passphrase is ever forgotten, this code gets you back into the book. Write it down and keep it somewhere safe, for example with a trusted family member. It is shown only once.</p>' +
      '<p class="recovery-code"><b>' + esc(code) + '</b></p>' +
      '<form id="recovery-code-form" novalidate>' +
      '<label class="fld check"><input name="saved" type="checkbox" required> <span>I have saved this recovery code</span></label>' +
      '<button type="submit" class="auth-go">Continue</button></form>' +
      '<p id="auth-msg" class="auth-msg" role="status"></p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function showRecoveryEntry() {
    var box = $('cloud-auth');
    box.innerHTML = '<div class="auth-card"><h2>Use the recovery code</h2>' +
      '<p class="hint">Enter the recovery code you were given when the passphrase was set. You will be able to open the book again.</p>' +
      '<form id="recovery-form" novalidate>' +
      '<label class="fld"><span>Recovery code</span><input name="code" autocomplete="off" autocapitalize="characters" required maxlength="24"></label>' +
      '<button type="submit" class="auth-go">Open the book</button></form>' +
      '<p class="auth-links"><a href="#" data-act="back">Back</a></p>' +
      '<p id="auth-msg" class="auth-msg" role="status"></p></div>';
    box.hidden = false;
    var bar = $('cloud-bar'); if (bar) bar.hidden = true;
  }

  function showChangePass() {
    var box = $('cloud-auth');
    box.innerHTML = '<div class="auth-card"><h2>Change the family passphrase</h2>' +
      '<p class="hint">Every section is re-encrypted with the new passphrase, and you will get a new recovery code. Keep this page open until it finishes. Other members will be asked for the new passphrase on their next visit.</p>' +
      '<form id="changepass-form" novalidate>' +
      '<label class="fld"><span>Current passphrase</span><input name="oldp" type="password" autocomplete="off" required></label>' +
      '<label class="fld"><span>New passphrase (at least ' + MIN_PASS + ' characters)</span><input name="newp" type="password" autocomplete="new-password" minlength="' + MIN_PASS + '" required></label>' +
      '<label class="fld"><span>Type the new passphrase again</span><input name="newp2" type="password" autocomplete="new-password" minlength="' + MIN_PASS + '" required></label>' +
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
      '' + // Passphrase rotation is paused: old multi-row re-encryption is not atomic.

      '<button type="button" class="row-act" data-act="leave">Leave family</button>' +
      '<button type="button" class="row-act del" data-act="delacct">Delete account</button>' +
      '<button type="button" class="row-act" data-act="signout">Sign out</button></div></div>' +
      (conflictingCopy ? '<div class="sync-conflict" role="alert"><b>Your edits are still on this device, but someone else saved this section online.</b><p>Nothing has been automatically erased. Choose which version to keep. Saving your copy will replace the online version of any section you changed.</p><button type="button" data-act="keep-local">Keep my changes</button> <button type="button" class="ghost" data-act="keep-cloud">Download backup, then use online version</button></div>' : '') +
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
        clearPass(family.id); // Read once to migrate old sessions; never retain the old plaintext secret.
        try { await unlock(saved, g); return; }
        catch (e) { if (/not correct/.test(e.message)) clearPass(family.id); }
      }
      showKeyScreen(g);
    } catch (err) {
      if (err.signedOut) { saveToken(null); showAuth('signin', 'Please sign in again.'); return; }
      // A transient network failure must NEVER replace a user's on-screen records
      // with the old unencrypted cache (which could belong to another session).
      if (api.active && keyObj && family) {
        setSaveMessage('The family service cannot be reached. Your current entries remain on this device.', true);
        return;
      }
      showAuth('signin', err.message + ' Existing encrypted drafts have not been erased.');
    }
  }

  function finishOpen(s, note) {
    api.active = true;
    opts.setState(s);
    hideAuth();
    showBar();
    opts.render();
    syncMsg(note || 'Ready. Each edit is stored on this device, then sent online.', false);
  }
  function recoverPreviousDraft(draft, server, g) {
    lastSynced = Object.assign({}, draft.lastSynced);
    baseTimes = Object.assign({}, draft.baseTimes);
    editRevision += 1;
    pendingState = cloneState(draft.state);
    finishOpen(draft.state, 'Recovered edits from this device. Checking whether they can be saved online…');
    // Conflict is assessed when flush obtains the newest server versions.
    persistDraft(pendingState).then(function () { scheduleFlush(150); });
  }

  // Checks the passphrase against the family check value, then loads the book.
  // If an earlier first-time setup stopped after saving keycheck, the admin can
  // complete the missing recovery-code step without overwriting any records.
  async function unlock(pass, g) {
    var key = await deriveKey(pass, family.id);
    var kc = g.data && g.data[KEYCHECK];
    if (!kc || kc.enc !== 1) throw new Error('The family admin needs to sign in once to set the family passphrase.');
    var check = null;
    try { check = await openValue(key, kc); } catch (e) { check = null; }
    if (check !== CHECK_TEXT) throw new Error('That passphrase is not correct for this family.');

    // The keycheck is written first, so an interrupted initial setup can leave
    // this recovery record absent. Complete it only after proving the passphrase.
    if (myRole === 'admin' && !(g.data[RECOVERY] && g.data[RECOVERY].enc === 1)) {
      var code = newRecoveryCode();
      var renv = await sealRecovery(code, pass, family.id);
      try {
        var rr = await call('saveBlock', {
          blockId: RECOVERY, data: renv, baseUpdatedAt: (g.times && g.times[RECOVERY]) || 0
        });
        g.data[RECOVERY] = renv;
        g.times = Object.assign({}, g.times || {});
        g.times[RECOVERY] = rr.savedAt;
        pendingOpen = g;
        // Never display a recovery code until the server confirms its save.
        showRecoveryCode(code, function () { return unlock(pass, g); });
        return;
      } catch (err) {
        if (!err.conflict) throw err;
        // Another session may have completed the recovery step already.
        var current = await call('getFamily');
        pendingOpen = current;
        if (current.data && current.data[RECOVERY] && current.data[RECOVERY].enc === 1) {
          await unlock(pass, current);
          return;
        }
        throw new Error('The recovery record changed during setup. Refresh and try again; your existing family data is safe.');
      }
    }

    var res = await decryptAll(g.data, key);
    keyObj = key;
    storePass(family.id, pass);
    var s = buildState(res.data);
    baseTimes = Object.assign({}, g.times || {});
    lastSynced = res.legacy ? {} : snapshot(s);
    var recovered = await loadDraft(family.id, key);
    if (recovered && !sameState(recovered.state, s)) {
      recoverPreviousDraft(recovered, s, g);
      return;
    }
    if (recovered) clearDraft(family.id);
    var oldCopy = readCache();
    if (oldCopy && !sameState(oldCopy, s)) {
      var restoreOld = typeof global.confirm === 'function' && global.confirm('An earlier version of this app kept a local copy that differs from Google Sheets. It may contain edits that never reached the server. Restore this older copy to review it? Choose Cancel to keep the online version.');
      if (restoreOld) {
        pendingState = cloneState(oldCopy);
        editRevision += 1;
        finishOpen(oldCopy, 'Old on-device entries recovered. Saving securely and checking for conflicts…');
        await persistDraft(pendingState);
        try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
        scheduleFlush(150);
        return;
      }
      // Preserve the legacy copy for manual backup; do not silently delete it.
      finishOpen(s, 'Online version opened. An older local copy remains in browser storage for recovery.');
      return;
    }
    if (oldCopy) { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }
    finishOpen(s, '');
    if (res.legacy) api.push(s);
  }

  // Admin sets the family passphrase for the first time. Always re-read the
  // server state first: pendingOpen may be stale and baseTimes is not loaded yet.
  async function createPassphrase(pass) {
    var g = await call('getFamily');
    pendingOpen = g;
    var existing = g.data && g.data[KEYCHECK];
    if (existing && existing.enc === 1) {
      // A previous attempt may already have saved keycheck, or another tab
      // may have initialized the family. Do not overwrite its passphrase.
      try { await unlock(pass, g); }
      catch (err) {
        if (err.message === 'That passphrase is not correct for this family.') {
          showKeyScreen(g, 'A family passphrase is already set. Enter the existing passphrase to open this book.');
          return;
        }
        throw err;
      }
      return;
    }
    // A malformed/older keycheck must never be silently overwritten.
    if ((g.times && Number(g.times[KEYCHECK])) || existing) {
      throw new Error('A passphrase record exists but cannot be read. Do not reset the family or delete its data; check the keycheck row in the Data sheet.');
    }
    var key = await deriveKey(pass, family.id);
    var env = await sealValue(key, CHECK_TEXT);
    try {
      var saved = await call('saveBlock', { blockId: KEYCHECK, data: env, baseUpdatedAt: 0 });
      g.data = g.data || {};
      g.times = Object.assign({}, g.times || {});
      g.data[KEYCHECK] = env;
      g.times[KEYCHECK] = saved.savedAt;
      pendingOpen = g;
    } catch (err) {
      if (!err.conflict) throw err;
      // A second tab won the race. Open only with the correct existing passphrase.
      var latest = await call('getFamily');
      pendingOpen = latest;
      if (latest.data && latest.data[KEYCHECK] && latest.data[KEYCHECK].enc === 1) {
        try { await unlock(pass, latest); }
        catch (unlockErr) {
          if (unlockErr.message === 'That passphrase is not correct for this family.') {
            showKeyScreen(latest, 'A family passphrase was set in another session. Enter that existing passphrase.');
            return;
          }
          throw unlockErr;
        }
        return;
      }
      throw new Error('Family setup changed during saving. Refresh and try again. No existing data was overwritten.');
    }
    // A recovery-code save may fail temporarily. If it does, a later unlock
    // with the same passphrase will safely resume the missing step.
    await unlock(pass, g);
  }

  async function handleRecoveryCodeSaved(form) {
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    if (!form.elements.saved.checked) { msg('Tick the box once you have saved the code.'); return; }
    var next = pendingNext; pendingNext = null;
    msg('Please wait…');
    try { if (next) await next(); } catch (err) { msg(err.message); }
  }

  // Opens the book with the recovery code: the stored passphrase is decrypted, then used like a normal unlock.
  async function handleRecovery(form) {
    var msg = function (t) { var el = $('auth-msg'); if (el) el.textContent = t; };
    var g = pendingOpen;
    if (!g || !family) { msg('Please sign in again.'); return; }
    var env = g.data && g.data[RECOVERY];
    if (!env || env.enc !== 1) { msg('This family has no recovery code yet. The admin can create one by changing the passphrase.'); return; }
    msg('Please wait…');
    var pass = null;
    try {
      var key = await recoveryKey(fieldVal(form, 'code'), family.id);
      var opened = await openValue(key, env);
      pass = opened && opened.p;
    } catch (e) { pass = null; }
    if (!pass) { msg('That recovery code is not correct.'); return; }
    try { await unlock(pass, g); }
    catch (err) { msg('The passphrase could not be restored from this code. Ask the family admin to change the passphrase.'); }
  }

  // The passphrase was changed by the admin: forget the old one and ask for the new one.
  function lockForNewPassphrase(g) {
    clearPass(family.id);
    keyObj = null; api.active = false;
    // Intentionally preserve the encrypted draft on this device. Never silently discard it.
    pendingOpen = g;
    showKeyScreen(g, 'The family passphrase has changed. Your unsent edits remain in encrypted browser storage. Do not clear this browser; contact the family admin.');
  }

  /* ---------- reliable saving ---------- */
  function scheduleFlush(delay) {
    clearTimeout(pushTimer);
    if (pendingState && !conflictingCopy && api.active) {
      pushTimer = setTimeout(function () { flush(); }, delay == null ? 650 : delay);
    }
  }
  api.push = function (s) {
    if (!api.active || !keyObj) return;
    editRevision += 1;
    clearTimeout(retryTimer); retryTimer = null;
    pendingState = cloneState(s); // never share the mutable form state with an in-flight request
    setSaveMessage('Saving on this device…');
    persistDraft(pendingState).then(function (ok) {
      if (ok && pendingState) setSaveMessage('Saved on this device. Syncing online…');
    });
    scheduleFlush(650); // cloud sync after typing pauses; NOT after finishing a row
  };
  function isChanged(id, s) { return snapshot(s)[id] !== lastSynced[id]; }
  async function checkRemoteBlock(g, id, desired) {
    // If the save succeeded but its network response was lost, treat identical server data as a success.
    if (!(g.data && g.data[id] && g.data[id].enc === 1)) return false;
    try { return JSON.stringify(await openValue(keyObj, g.data[id])) === desired; }
    catch (e) { return false; }
  }
  async function runFlush() {
    if (!pendingState || !api.active || !keyObj || conflictingCopy) return;
    var seq = editRevision, copy = cloneState(pendingState), snap = snapshot(copy);
    var ids = BLOCKS.map(function (b) { return b.id; }).concat(['checks']);
    var changed = ids.filter(function (id) { return snap[id] !== lastSynced[id]; });
    try {
      await draftPromise;
      if (!changed.length) {
        if (seq === editRevision) {
          pendingState = null;
          clearDraft(family.id);
          setSaveMessage('Saved online.');
        }
        return;
      }
      setSaveMessage('Saved on this device. Saving online…');
      var g = await call('getFamily');
      if (!(await keyStillValid(g))) { lockForNewPassphrase(g); return; }
      for (var i = 0; i < changed.length; i++) {
        var id = changed[i];
        if ((Number(g.times && g.times[id]) || 0) !== (Number(baseTimes[id]) || 0)) {
          if (await checkRemoteBlock(g, id, snap[id])) {
            baseTimes[id] = Number(g.times[id]) || 0;
            lastSynced[id] = snap[id];
            continue;
          }
          conflictingCopy = g;
          showBar();
          setSaveMessage('Save conflict: your changes remain on this device. Choose a version above; nothing was erased.', true);
          return;
        }
        var env = await sealValue(keyObj, JSON.parse(snap[id]));
        try {
          var answer = await call('saveBlock', { blockId: id, data: env, baseUpdatedAt: baseTimes[id] || 0 });
          baseTimes[id] = answer.savedAt;
          lastSynced[id] = snap[id];
          g.times[id] = answer.savedAt;
          g.data[id] = env;
        } catch (error) {
          if (!error.conflict) throw error;
          // On a lost acknowledgement, the remote may already contain our data.
          var latest = await call('getFamily');
          if (await checkRemoteBlock(latest, id, snap[id])) {
            baseTimes[id] = Number(latest.times[id]) || 0;
            lastSynced[id] = snap[id];
            continue;
          }
          conflictingCopy = latest;
          showBar();
          setSaveMessage('Save conflict: your changes remain on this device. Review the choices above.', true);
          return;
        }
      }
      if (seq === editRevision) {
        pendingState = null;
        clearDraft(family.id);
        setSaveMessage('All changes saved online at ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + '.');
      } else {
        setSaveMessage('Recent edits saved on this device; syncing the latest changes…');
      }
    } catch (err) {
      setSaveMessage('Online save not finished: ' + err.message + '. The app will retry. Keep a backup if possible.', true);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { retryTimer = null; flush(); }, 12000);
    }
  }
  function flush() {
    if (activeFlush) return activeFlush;
    activeFlush = runFlush().finally(function () {
      activeFlush = null;
      if (pendingState && !conflictingCopy && api.active && !retryTimer) scheduleFlush(120);
    });
    return activeFlush;
  }
  function saveLocalBackup(s) {
    var blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'family-book-unsaved-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  async function resolveConflict(choice) {
    if (!conflictingCopy || !keyObj || !pendingState) return;
    var saveLocal = choice === 'local';
    var warning = saveLocal
      ? 'Your edited sections will replace the other family member’s online changes in those sections. Continue?'
      : 'A backup of YOUR current entries will download first. Then the online copy will open. The backup contains private data. Continue?';
    if (!global.confirm(warning)) return;
    if (!saveLocal) saveLocalBackup(pendingState);
    // Do not apply a conflict decision computed from a now-stale editing snapshot.
    // The user may keep typing while getFamily/decryption is in progress.
    var decisionRevision = editRevision;
    var decisionFamilyId = family && family.id;
    function decisionStillValid() {
      return api.active && family && family.id === decisionFamilyId &&
        editRevision === decisionRevision && !!pendingState && !!conflictingCopy;
    }
    var fresh;
    try { fresh = await call('getFamily'); }
    catch (err) { setSaveMessage('Could not retrieve the online version. Your entries are still safely pending on this device.', true); return; }
    if (!decisionStillValid()) {
      setSaveMessage('You edited the form while the conflict was being checked. Your new entries were kept. Choose an option again.', true);
      return;
    }
    if (!(await keyStillValid(fresh))) { lockForNewPassphrase(fresh); return; }
    var remote = buildState((await decryptAll(fresh.data, keyObj)).data);
    if (!decisionStillValid()) {
      setSaveMessage('You edited the form while the conflict was being checked. Your new entries were kept. Choose an option again.', true);
      return;
    }
    var desired = cloneState(pendingState), remoteSnap = snapshot(remote), desiredSnap = snapshot(desired);
    if (saveLocal) {
      // Merge untouched sections from the newest server state; edited sections stay local.
      BLOCKS.map(function (b) { return b.id; }).concat(['checks']).forEach(function (id) {
        if (desiredSnap[id] === lastSynced[id]) desired[id] = remote[id];
      });
    } else {
      desired = remote;
    }
    baseTimes = Object.assign({}, fresh.times || {});
    lastSynced = remoteSnap;
    conflictingCopy = null;
    showBar();
    opts.setState(desired); opts.render();
    if (saveLocal) {
      editRevision += 1;
      pendingState = cloneState(desired);
      await persistDraft(pendingState);
      scheduleFlush(100);
      setSaveMessage('Your chosen version is being saved online…');
    } else {
      pendingState = null;
      clearDraft(family.id);
      setSaveMessage('Online version opened; a backup of your earlier entries was downloaded.');
    }
  }
  api.refresh = async function () {
    if (!api.active || !keyObj) return;
    if (conflictingCopy) {
      showBar();
      setSaveMessage('Your unsaved changes are protected. Resolve the conflict before refreshing.', true);
      return;
    }
    if (pendingState || activeFlush) {
      clearTimeout(pushTimer);
      await flush();
      if (pendingState || activeFlush || conflictingCopy) return;
    }
    // Record an editing generation BEFORE fetching. Any input after this point
    // invalidates the downloaded snapshot, even if it has finished saving meanwhile.
    var refreshRevision = editRevision;
    var refreshFamilyId = family && family.id;
    function mayReplaceForm() {
      return api.active && !!keyObj && family && family.id === refreshFamilyId &&
        refreshRevision === editRevision && !pendingState && !activeFlush &&
        !conflictingCopy && !(opts && opts.isEditing && opts.isEditing());
    }
    // Never tear down an input which is currently being edited.
    if (!mayReplaceForm()) return;
    try {
      var g = await call('getFamily');
      if (!mayReplaceForm()) return;
      if (!(await keyStillValid(g))) { lockForNewPassphrase(g); return; }
      if (!mayReplaceForm()) return;
      var res = await decryptAll(g.data, keyObj);
      if (!mayReplaceForm()) return; // CRITICAL: recheck AFTER all async work.
      var s = buildState(res.data);
      if (!mayReplaceForm()) return; // A newer keystroke must always win.
      family = g.family; myRole = g.role; members = g.members || []; requests = g.requests || [];
      lastSynced = snapshot(s); baseTimes = Object.assign({}, g.times || {});
      opts.setState(s); opts.render(); showBar();
      setSaveMessage('Up to date with the online family book.');
    } catch (err) { setSaveMessage(err.message, true); }
  };

  async function signOut() {
    if (hasPending()) {
      var proceed = global.confirm('Some edits have NOT been confirmed online. An encrypted local recovery copy is kept in this browser, but may be lost if its storage is cleared. Sign out anyway?');
      if (!proceed) return;
      await draftPromise;
    }
    try { await call('logout'); } catch (e) {}
    if (family) clearPass(family.id);
    saveToken(null);
    // Never delete a legacy local copy during sign-out: it may contain unsynced old-version edits.
    user = null; family = null; members = []; requests = []; api.active = false;
    pendingState = null; conflictingCopy = null; activeFlush = null;
    keyObj = null; pendingOpen = null;
    opts.setState(blankState()); opts.render();
    var clear = $('clear-btn'); if (clear) clear.hidden = false;
    showAuth('signin', 'Signed out. Any unsynced encrypted draft remains in this browser for later recovery.');
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
    if (form.dataset.busy === '1') return; // Prevent two simultaneous setup submissions.
    var mode = form.dataset.mode, pass = form.elements.pass.value;
    if (pass.length < MIN_PASS) { msg('Use at least ' + MIN_PASS + ' characters.'); return; }
    if (mode === 'create' && form.elements.pass2.value !== pass) { msg('The two passphrases do not match.'); return; }
    form.dataset.busy = '1';
    var button = form.querySelector && form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    msg('Please wait…');
    try {
      if (mode === 'create') await createPassphrase(pass);
      else await unlock(pass, pendingOpen);
    } catch (err) { msg(err.message); }
    finally {
      form.dataset.busy = '0';
      if (button) button.disabled = false;
    }
  }

  async function handleChangePass(form) {
    var msg = $('auth-msg');
    if (msg) msg.textContent = 'Changing the passphrase is temporarily disabled. The old implementation re-encrypted each section separately and could leave the family book unreadable after an interruption. We will restore this feature only with a safe all-or-nothing key rotation.';
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
    if (f.id === 'recovery-code-form') { e.preventDefault(); handleRecoveryCodeSaved(f); }
    if (f.id === 'recovery-form') { e.preventDefault(); handleRecovery(f); }
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
    if (act === 'keep-local') { resolveConflict('local'); return; }
    if (act === 'keep-cloud') { resolveConflict('cloud'); return; }
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
    if (act === 'recovery') { showRecoveryEntry(); return; }
    if (act === 'delacct') { showDeleteAccount(); return; }
  });

  /* ---------- start ---------- */
  api.start = function (o) {
    opts = o;
    if (!api.configured) { o.render(); return; }
    o.render();
    window.addEventListener('online', function () { if (pendingState && !conflictingCopy) { clearTimeout(retryTimer); retryTimer = null; flush(); } });
    window.addEventListener('beforeunload', function (event) {
      // Modern phones can kill a page without delivering this event; the encrypted draft is primary.
      if (hasPending()) { event.preventDefault(); event.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && pendingState && !conflictingCopy) {
        clearTimeout(retryTimer); retryTimer = null; flush();
      }
      // Do not silently pull and redraw all forms when the user returns to the app.
      // To see another family member's changes, use the explicit Refresh action.
    });
    try { token = localStorage.getItem(SESSION_KEY); } catch (e) { token = null; }
    if (token) openFamily();
    else showAuth('signin');
  };

  // Used by tests only.
  api._crypto = { authKey: authKey, deriveKey: deriveKey, sealValue: sealValue, openValue: openValue, decryptAll: decryptAll, KEYCHECK: KEYCHECK, CHECK_TEXT: CHECK_TEXT };
})(typeof window !== 'undefined' ? window : globalThis);
