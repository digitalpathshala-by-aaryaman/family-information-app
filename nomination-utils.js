/* Read-only nominee summary from the source records. Avoid duplicate manual entry.
   No extra records are stored or written to Google Sheets by this summary. */
(function (global) {
  'use strict';
  function linked(state) {
    var out = [];
    var types = [
      ['bank', 'Bank account', function (r) { return [r.bank, r.last4 ? '(…' + r.last4 + ')' : ''].filter(Boolean).join(' '); }],
      ['fd', 'FD / RD', function (r) { return [r.bank, r.type].filter(Boolean).join(' · '); }],
      ['inv', 'Investment', function (r) { return [r.type, r.where, r.ref ? '(…' + r.ref + ')' : ''].filter(Boolean).join(' · '); }],
      ['ins', 'Insurance', function (r) { return [r.company, r.plan, r.ref ? '(…' + r.ref + ')' : ''].filter(Boolean).join(' · '); }]
    ];
    types.forEach(function (type) {
      (Array.isArray(state[type[0]]) ? state[type[0]] : []).forEach(function (r) {
        if (!r || !Object.keys(r).some(function (k) { return k !== '_upd' && k[0] !== '_' && !!r[k]; })) return;
        var nominee = r.nomReg === 'No' ? '' : (r.nominee === 'Other person' ? (r.nomineeOther || 'Other person — name missing') : r.nominee);
        var status = r.nomReg === 'Yes' ? 'Yes' : r.nomReg === 'No' ? 'No' : 'Needs checking';
        out.push({source:type[1],holder:r.holder || '', asset:type[2](r), nominee:nominee || '',
          relationship:r.nomineeRel || '', status:status, checked:r._upd || ''});
      });
    });
    return out;
  }
  global.FamilyNomination = { linked: linked };
})(typeof window !== 'undefined' ? window : globalThis);
