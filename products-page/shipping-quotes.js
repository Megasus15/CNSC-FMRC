/* Quote state shared by single-product and cart checkout. */
(() => {
  'use strict';
  window.FMRCShippingQuotes = {
    create({ read, request, render, setReady, delay = 180 }) {
      let key = '', quote = null, busy = false, message = '', failed = false;
      let generation = 0, timer, expiry, controller;
      const summary = () => quote?.fulfillment_type==='pickup' ? 'Pickup at FMRC has no shipping fee.' : 'Shipping is charged once per order. Delivery dates are estimates.';
      const ready = () => !!quote?.available && !busy && Date.parse(quote.expires_at) > Date.now();
      const paint = () => {
        setReady(ready());
        render({ quote, busy, message, failed, ready: ready() });
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
        quote = null; failed = false;
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
            quote = data; busy = false;
            message = quote.available ? summary() : quote.message;
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
        token() {
          if (ready() && key === JSON.stringify(read())) return quote.quote_token;
          refresh(true); return null;
        },
        total() { return ready() ? quote.payable_total : null; },
        reject(updated, submittedToken) {
          // A response for an earlier submission must not replace a newer selection.
          if (key !== JSON.stringify(read()) || (submittedToken && quote?.quote_token !== submittedToken)) {
            refresh(); return;
          }
          ++generation; controller?.abort(); clearTimeout(timer); clearTimeout(expiry);
          busy = false; failed = false; quote = updated || null;
          message = updated?.available ? 'Order summary updated. Select Place order to continue with the updated total.'
            : updated?.message || 'Your shipping quote is unavailable. Retry or choose pickup.';
          if (!updated) failed = true;
          scheduleExpiry(); paint();
        },
      };
    },
  };
})();
