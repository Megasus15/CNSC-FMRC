/* Deterministic approved-answer retrieval. No external AI or private lookups. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FMRCSupportAnswers = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const stop = new Set('a an the is are was be can could do does did how what where why when today would want need have i me my we our you your to for of on in at and or it this that please po ba paano ako ko ang ng mga sa na naman lang may pwede puwede gusto mag maka'.split(' '));
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  function tokens(value) {
    return [...new Set(normalize(value).split(' ').filter(t => t && !stop.has(t)).map(t => ({ordering:'order',orders:'order',products:'product',payments:'payment',appointments:'appointment',refunds:'refund',magorder:'order',umorder:'order',oorder:'order',bumili:'buy',buying:'buy',booking:'book',bookings:'book',magbook:'book'})[t] || t))];
  }
  function similar(a, b) {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 4) return false;
    const limit = Math.min(a.length, b.length) >= 7 ? 2 : 1;
    if (Math.abs(a.length - b.length) > limit) return false;
    let row = Array.from({length:b.length + 1}, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < b.length; j++) next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1));
      row = next;
    }
    return row[b.length] <= limit;
  }
  function find(question, faqs) {
    const text = normalize(question), terms = tokens(question);
    if (!terms.length || text.length > 500) return {answer:null, suggestions:[]};
    const ranked = faqs.filter(f => f.enabled !== false).map(faq => {
      const phrases = [faq.en.question, faq.fil.question, ...(faq.aliases || [])];
      let score = 0;
      for (const phrase of phrases) {
        if (normalize(phrase) === text) { score = 1.3; break; }
        const target = tokens(phrase);
        if (!target.length) continue;
        const matches = terms.filter(q => target.some(t => similar(q, t))).length;
        const targetMatches = target.filter(t => terms.some(q => similar(q, t))).length;
        score = Math.max(score, .76 * matches / terms.length + .24 * targetMatches / target.length);
      }
      return {faq, score};
    }).filter(row => row.score >= .45).sort((a, b) => b.score - a.score);
    const first = ranked[0], next = ranked[1];
    const strong = first && first.score >= .76 && (terms.length >= 2 || first.score > 1)
      && (!next || first.score - next.score >= .12);
    return {answer:strong ? first.faq : null, suggestions:ranked.slice(0, 3).map(row => row.faq)};
  }
  return {find, normalize};
});
