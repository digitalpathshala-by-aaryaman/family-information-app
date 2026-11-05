/* Family Information Book: server code for Google Sheets.
   Paste this into Extensions > Apps Script of your Google Sheet, run setupSheets() once,
   then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). */

var SHEET = { users: 'Users', families: 'Families', members: 'Members', data: 'Data', sessions: 'Sessions' };
var HEAD = {
  Users: ['email', 'name', 'salt', 'hash', 'verified', 'created_at', 'code_hash', 'code_purpose', 'code_expires', 'fails', 'code_fails', 'code_sent_at'],
  Families: ['family_id', 'name', 'join_code', 'created_by', 'created_at'],
  Members: ['family_id', 'email', 'role', 'joined_at'],
  Data: ['family_id', 'block_id', 'json', 'updated_by', 'updated_at'],
  Sessions: ['token_hash', 'email', 'expires_at']
};
var BLOCK_IDS = ['me','family','contacts','keys','bank','fd','inv','ins','prop','veh','loan','bill','docs','nom','other','medical','dig','plan','checks'];
var MAX_CELL = 45000;          // Google Sheets allows about 50,000 characters per cell
var SESSION_DAYS = 30;
var CODE_MINUTES = 15;
var HASH_ROUNDS = 5000;

/* ---------- entry points ---------- */
function doGet() { return reply({ ok: true, service: 'Family Information Book' }); }

function doPost(e) {
  var out;
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    lock.waitLock(15000);
    out = route(String(body.action || ''), body);
  } catch (err) {
    out = { ok: false, error: userMessage(err) };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
  return reply(out);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userMessage(err) {
  var m = String(err && err.message || err);
  if (m.indexOf('U:') === 0) return m.slice(2);
  Logger.log(m);
  return 'Something went wrong. Please try again.';
}

function fail(msg) { throw new Error('U:' + msg); }

/* ---------- one-time setup ---------- */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEAD).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  // Store everything as text so Sheets never turns codes or hashes into numbers.
  Object.keys(HEAD).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var rows = Math.max(sh.getMaxRows() - 1, 1);
    sh.getRange(2, 1, rows, HEAD[name].length).setNumberFormat('@');
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
}

/* ---------- routing ---------- */
function route(action, b) {
  switch (action) {
    case 'signup': return signup(b);
    case 'confirm': return confirmEmail(b);
    case 'resend': return resendCode(b);
    case 'login': return login(b);
    case 'requestReset': return requestReset(b);
    case 'resetPassword': return resetPassword(b);
    case 'me': return me(b);
    case 'logout': return logout(b);
    case 'createFamily': return createFamily(b);
    case 'joinFamily': return joinFamily(b);
    case 'getFamily': return getFamily(b);
    case 'saveBlock': return saveBlock(b);
    case 'newCode': return newCode(b);
    case 'removeMember': return removeMember(b);
    default: fail('Unknown request.');
  }
}

/* ---------- accounts ---------- */
function signup(b) {
  var email = cleanEmail(b.email), name = String(b.name || '').trim().slice(0, 80);
  if (!name) fail('Please enter your full name.');
  checkPassword(b.password);
  if (findUser(email)) fail('An account with this email already exists. Please sign in.');
  var salt = newToken(16);
  appendRow(SHEET.users, { email: email, name: name, salt: salt, hash: hashPassword(b.password, salt), verified: 0, created_at: Date.now(), fails: 0 });
  sendCode(email, 'signup');
  return { ok: true, needsConfirm: true };
}

function confirmEmail(b) {
  var email = cleanEmail(b.email);
  var u = checkCode(email, b.code, 'signup');
  updateRow(SHEET.users, u.row, { verified: 1, code_hash: '', code_expires: 0, code_purpose: '' });
  return sessionFor(email);
}

function resendCode(b) {
  var email = cleanEmail(b.email), purpose = b.purpose === 'reset' ? 'reset' : 'signup';
  var u = findUser(email);
  if (u && (purpose === 'reset' || Number(u.obj.verified) !== 1)) { try { sendCode(email, purpose); } catch (e) {} }
  return { ok: true };
}

function login(b) {
  var email = cleanEmail(b.email);
  var u = findUser(email);
  if (!u) fail('Email or password is not correct.');
  if (u.obj.fails >= 10) fail('Too many wrong attempts. Use "Forgot password" to set a new one.');
  if (hashPassword(b.password, u.obj.salt) !== u.obj.hash) {
    updateRow(SHEET.users, u.row, { fails: Number(u.obj.fails || 0) + 1 });
    fail('Email or password is not correct.');
  }
  if (Number(u.obj.verified) !== 1) {
    try { sendCode(email, 'signup'); } catch (e) {}
    return { ok: false, needsConfirm: true, error: 'Please confirm your email. We sent a new code.' };
  }
  updateRow(SHEET.users, u.row, { fails: 0 });
  return sessionFor(email);
}

function requestReset(b) {
  var email = cleanEmail(b.email);
  if (findUser(email)) { try { sendCode(email, 'reset'); } catch (e) {} } // same answer whether or not the email has an account
  return { ok: true };
}

function resetPassword(b) {
  var email = cleanEmail(b.email);
  checkPassword(b.password);
  var u = checkCode(email, b.code, 'reset');
  var salt = newToken(16);
  updateRow(SHEET.users, u.row, { salt: salt, hash: hashPassword(b.password, salt), verified: 1, code_hash: '', code_expires: 0, code_purpose: '', fails: 0, code_fails: 0 });
  return sessionFor(email);
}

function me(b) {
  var s = sessionUser(b.token);
  var m = membershipOf(s.email);
  return { ok: true, user: { email: s.email, name: s.name }, family: m ? { id: m.family.id, name: m.family.name, join_code: m.family.join_code } : null, role: m ? m.member.role : null };
}

function logout(b) {
  var row = findRow(SHEET.sessions, { token_hash: sha(String(b.token || '')) });
  if (row) deleteRow(SHEET.sessions, row.row);
  return { ok: true };
}

/* ---------- families ---------- */
function createFamily(b) {
  var s = sessionUser(b.token);
  if (membershipOf(s.email)) fail('You already belong to a family.');
  var name = String(b.name || '').trim().slice(0, 80);
  if (!name) fail('Please enter a family name.');
  var id = newToken(8), code = newCode8();
  appendRow(SHEET.families, { family_id: id, name: name, join_code: code, created_by: s.email, created_at: Date.now() });
  appendRow(SHEET.members, { family_id: id, email: s.email, role: 'admin', joined_at: Date.now() });
  return { ok: true };
}

function joinFamily(b) {
  var s = sessionUser(b.token);
  if (membershipOf(s.email)) fail('You already belong to a family.');
  var code = String(b.code || '').trim().toUpperCase();
  var fam = findRow(SHEET.families, { join_code: code });
  if (!fam) fail('That family code is not valid. Check it with your family admin.');
  appendRow(SHEET.members, { family_id: fam.obj.family_id, email: s.email, role: 'member', joined_at: Date.now() });
  return { ok: true };
}

function getFamily(b) {
  var s = sessionUser(b.token);
  var m = membershipOf(s.email);
  if (!m) fail('You are not in a family yet.');
  var fid = m.family.family_id;
  var members = rowsWhere(SHEET.members, { family_id: fid }).map(function (r) {
    var u = findUser(r.obj.email);
    return { email: r.obj.email, name: u ? u.obj.name : 'Family member', role: r.obj.role, me: r.obj.email === s.email };
  });
  var data = {}, times = {};
  rowsWhere(SHEET.data, { family_id: fid }).forEach(function (r) {
    try { data[r.obj.block_id] = JSON.parse(r.obj.json); } catch (e) {}
    times[r.obj.block_id] = Number(r.obj.updated_at) || 0;
  });
  return { ok: true, family: { id: fid, name: m.family.name, join_code: m.family.join_code }, role: m.member.role, members: members, data: data, times: times };
}

function saveBlock(b) {
  var s = sessionUser(b.token);
  var m = membershipOf(s.email);
  if (!m) fail('You are not in a family yet.');
  var block = String(b.blockId || '');
  if (BLOCK_IDS.indexOf(block) < 0) fail('Unknown section.');
  var json = JSON.stringify(b.data == null ? null : b.data);
  if (json.length > MAX_CELL) fail('This section has too many entries for one save. Remove a few rows or split them.');
  var fid = m.family.family_id;
  var row = findRow(SHEET.data, { family_id: fid, block_id: block });
  // Refuse to overwrite a section that someone else changed after this device last loaded it.
  var base = Number(b.baseUpdatedAt) || 0;
  if (row && Number(row.obj.updated_at) > base) {
    return { ok: false, conflict: true, error: 'Someone in your family changed this section first, so your last change was not saved. The latest version is now shown. Please enter your change again.' };
  }
  var now = Date.now();
  var rec = { family_id: fid, block_id: block, json: json, updated_by: s.email, updated_at: now };
  if (row) updateRow(SHEET.data, row.row, rec); else appendRow(SHEET.data, rec);
  return { ok: true, savedAt: now };
}

function newCode(b) {
  var s = sessionUser(b.token);
  var m = membershipOf(s.email);
  if (!m || m.member.role !== 'admin') fail('Only the family admin can do this.');
  var code = newCode8();
  updateRow(SHEET.families, m.family.row, { join_code: code });
  return { ok: true, join_code: code };
}

function removeMember(b) {
  var s = sessionUser(b.token);
  var m = membershipOf(s.email);
  if (!m || m.member.role !== 'admin') fail('Only the family admin can remove members.');
  var target = cleanEmail(b.email);
  if (target === s.email) fail('The admin cannot remove themselves.');
  var row = findRow(SHEET.members, { family_id: m.family.family_id, email: target });
  if (row) deleteRow(SHEET.members, row.row);
  return { ok: true };
}

/* ---------- sessions and codes ---------- */
function sessionFor(email) {
  var token = newToken(24);
  appendRow(SHEET.sessions, { token_hash: sha(token), email: email, expires_at: Date.now() + SESSION_DAYS * 864e5 });
  var u = findUser(email);
  return { ok: true, token: token, user: { email: email, name: u.obj.name } };
}

function sessionUser(token) {
  var row = findRow(SHEET.sessions, { token_hash: sha(String(token || '')) });
  if (!row || Number(row.obj.expires_at) < Date.now()) fail('Please sign in again.');
  var u = findUser(row.obj.email);
  if (!u) fail('Please sign in again.');
  return { email: row.obj.email, name: u.obj.name };
}

function sendCode(email, purpose) {
  var code = String(Math.floor(100000 + Math.random() * 900000));
  var u = findUser(email);
  if (Number(u.obj.code_sent_at || 0) > Date.now() - 60000) fail('Please wait a minute before asking for another code.');
  updateRow(SHEET.users, u.row, { code_hash: sha(code + ':' + purpose), code_purpose: purpose, code_expires: Date.now() + CODE_MINUTES * 60000, code_sent_at: Date.now(), code_fails: 0 });
  var what = purpose === 'reset' ? 'reset your password' : 'confirm your email';
  MailApp.sendEmail(email, 'Family Information Book: your code',
    'Your 6-digit code to ' + what + ' is: ' + code + '\n\nIt expires in ' + CODE_MINUTES + ' minutes. If you did not ask for this, ignore this email.');
}

function checkCode(email, code, purpose) {
  var u = findUser(email);
  if (!u) fail('That code is not valid. Send a new code.');
  var o = u.obj;
  if (Number(o.code_fails || 0) >= 5) fail('Too many wrong codes. Send a new code.');
  var ok = o.code_purpose === purpose && Number(o.code_expires) > Date.now() &&
           o.code_hash === sha(String(code || '').replace(/\s/g, '') + ':' + purpose);
  if (!ok) {
    updateRow(SHEET.users, u.row, { code_fails: Number(o.code_fails || 0) + 1 });
    fail('That code is not valid or has expired. Send a new code.');
  }
  return u;
}

/* ---------- helpers ---------- */
function cleanEmail(e) {
  var v = String(e || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) fail('Please enter a valid email address.');
  return v;
}
function checkPassword(p) {
  if (String(p || '').length < 8) fail('Password must be at least 8 characters.');
}
function newToken(bytes) {
  var out = '';
  for (var i = 0; i < bytes * 2; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}
function newCode8() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
  for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
function sha(text) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}
function hashPassword(pw, salt) {
  var h = salt + ':' + pw;
  for (var i = 0; i < HASH_ROUNDS; i++) h = sha(h + salt);
  return h;
}
function membershipOf(email) {
  var m = findRow(SHEET.members, { email: email });
  if (!m) return null;
  var f = findRow(SHEET.families, { family_id: m.obj.family_id });
  if (!f) return null;
  return { member: m.obj, family: Object.assign({ row: f.row }, f.obj) };
}
function findUser(email) { return findRow(SHEET.users, { email: email }); }

/* ---------- sheet access ---------- */
function sheetFor(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) fail('The sheet "' + name + '" is missing. Run setupSheets() first.');
  return sh;
}
function readAll(name) {
  var sh = sheetFor(name), head = HEAD[name];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  return vals.map(function (r, i) {
    var o = {};
    head.forEach(function (k, j) { o[k] = r[j]; });
    return { row: i + 2, obj: o };
  });
}
function findRow(name, match) {
  var list = readAll(name);
  for (var i = 0; i < list.length; i++) {
    if (matches(list[i].obj, match)) return list[i];
  }
  return null;
}
function rowsWhere(name, match) {
  return readAll(name).filter(function (r) { return matches(r.obj, match); });
}
function matches(obj, match) {
  return Object.keys(match).every(function (k) { return String(obj[k]) === String(match[k]); });
}
function appendRow(name, obj) {
  var sh = sheetFor(name);
  sh.getRange(sh.getLastRow() + 1, 1, 1, HEAD[name].length).setValues([HEAD[name].map(function (k) { return obj[k] === undefined ? '' : obj[k]; })]);
}
function updateRow(name, row, changes) {
  var sh = sheetFor(name), head = HEAD[name];
  Object.keys(changes).forEach(function (k) {
    var col = head.indexOf(k);
    if (col >= 0) sh.getRange(row, col + 1).setValue(changes[k]);
  });
}
function deleteRow(name, row) {
  sheetFor(name).deleteRow(row);
}
