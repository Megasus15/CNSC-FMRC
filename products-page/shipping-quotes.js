/* Quote state shared by single-product and cart checkout. */
(() => {
  'use strict';
  window.FMRCShippingQuotes = {
    create({ read, request, render, setReady, delay = 180 }) {
      let key = '', quote = null, busy = false, review = false, message = '', failed = false;
      let generation = 0, timer, expiry, controller, acceptedBefore = false;
      const summary = () => quote?.fulfillment_type==='pickup' ? 'Pickup at FMRC has no shipping fee.' : 'Shipping is charged once per order. Delivery dates are estimates.';
      const ready = () => !!quote?.available && !busy && !review && Date.parse(quote.expires_at) > Date.now();
      const paint = () => {
        setReady(ready());
        render({ quote, busy, review, message, failed, ready: ready() });
      };
      const scheduleExpiry = () => {
        clearTimeout(expiry);
        if (quote?.available) expiry = setTimeout(() => refresh(true), Math.max(0, Date.parse(quote.expires_at) - Date.now()));
      };
      const refresh = (force = false) => {
        const input = read();
        const next = JSON.stringify(input);
        if (!force && key === next) { paint(); return; }
        key = next;
        const current = ++generation;
        controller?.abort(); clearTimeout(timer); clearTimeout(expiry);
        quote = null; review = false; failed = false;
        if (!input || input.error) {
          busy = false; message = input?.error || 'Choose your order and fulfillment method to calculate the total.'; paint(); return;
        }
        busy = true; message = 'Calculating shipping and delivery estimate…'; paint();
        timer = setTimeout(async () => {
          const activeRequest = new AbortController();
          controller = activeRequest;
          const deadline = setTimeout(()=>activeRequest.abort(),15000);
          try {
            const data = await request(input, activeRequest.signal);
            if (current !== generation) return;
            quote = data; busy = false; review = !!quote.available && acceptedBefore;
            if (!quote.available) message = quote.message;
            else {
              message = review ? 'Review the updated shipping fee, total, and delivery estimate before continuing.' : summary();
              if (!review) acceptedBefore = true;
            }
            scheduleExpiry(); paint();
          } catch (error) {
            if (current !== generation) return;
            busy = false; failed = true;
            message = error.name==='AbortError' || error.name==='TimeoutError' ? 'Shipping calculation timed out. Please retry.'
              : error.name==='TypeError' ? 'Shipping could not be calculated. Check your connection and retry.' : error.message || 'Shipping could not be calculated. Please retry.';
            paint();
          } finally { clearTimeout(deadline); }
        }, delay);
      };
      return {
        refresh,
        accept() { if (quote?.available && Date.parse(quote.expires_at) > Date.now()) { review = false; acceptedBefore = true; message = summary(); paint(); } else refresh(true); },
        token() {
          if (ready() && key === JSON.stringify(read())) return quote.quote_token;
          refresh(true); return null;
        },
        total() { return ready() ? quote.payable_total : null; },
        reject(updated) {
          ++generation; controller?.abort(); clearTimeout(timer); clearTimeout(expiry);
          busy = false; failed = false; quote = updated || null; review = true;
          message = updated?.available ? 'Your quote changed. Review and accept the updated total before placing your order.'
            : updated?.message || 'Your shipping quote is unavailable. Retry or choose pickup.';
          if (!updated) { failed = true; review = false; }
          scheduleExpiry(); paint();
        },
      };
    },
  };
})();
