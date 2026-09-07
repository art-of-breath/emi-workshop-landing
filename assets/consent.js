/* ============================================================
   Mutterlinien · Einwilligung + Meta Pixel
   ------------------------------------------------------------
   Vertrag (übernommen aus cookie-consent-guide.md des
   Trainer-Projekts, angepasst an Emis Designsystem und an Meta
   statt GA4):

   1. Ohne gespeicherte Entscheidung: Banner zeigen, NICHTS laden.
   2. marketing:false gespeichert: kein Banner, nichts laden.
   3. marketing:true gespeichert: kein Banner, Pixel sofort laden.
   4. Ablehnen ist genau ein Klick, gleiche Zeile, gleiche Größe
      wie Akzeptieren. Keine vorangekreuzten Felder.
   5. Entscheidung älter als 12 Monate: neu fragen.
   6. Widerruf über den Fußzeilen-Link. Wird die Einwilligung
      zurückgezogen, werden _fbp und _fbc gelöscht und die Seite
      neu geladen, damit kein geladenes Skript weiterläuft.

   Rechtlicher Hintergrund: LG Leipzig 04.07.2025 und OLG München
   18.12.2025. Meta Business Tools, die Conversions API
   ausdrücklich eingeschlossen, brauchen vorherige Einwilligung.
   Ein Hinweis in der Datenschutzerklärung genügt nicht.
   ============================================================ */
(function () {
  'use strict';

  var PIXEL_ID = '4636136706618538';     // Meta Events Manager, eingetragen 31.08.2026
  var KEY = 'emi-consent';
  var CID_KEY = 'emi-cid';
  var MAX_AGE_DAYS = 365;

  /* Conversions API. Der Browser schickt dasselbe Event zusaetzlich an unseren
     Server, der es an Meta weiterreicht. Beide tragen dieselbe event_id, damit
     Meta sie als ein Ereignis zaehlt statt als zwei.

     Der Server sieht nur, was hier steht. Ohne Einwilligung wird gar nichts
     gesendet, auch serverseitig nicht (LG Leipzig 04.07.2025, OLG Muenchen
     18.12.2025 - die CAPI ist ausdruecklich mitgemeint). */
  var CAPI_ENDPOINT = 'https://n8n.nicosmat.com/webhook/capi/emi';

  /* ---------- Speicher ---------- */
  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || v.v !== 1 || typeof v.marketing !== 'boolean') return null;
      var age = (Date.now() - new Date(v.ts).getTime()) / 86400000;
      if (!isFinite(age) || age > MAX_AGE_DAYS) return null;
      return v;
    } catch (e) { return null; }
  }

  function write(marketing) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 1, marketing: marketing, ts: new Date().toISOString()
      }));
    } catch (e) { /* privater Modus: Entscheidung gilt nur für diese Sitzung */ }
  }

  function dropMetaCookies() {
    var host = location.hostname;
    var domains = ['', host, '.' + host];
    var parts = host.split('.');
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    ['_fbp', '_fbc'].forEach(function (name) {
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
          (d ? '; domain=' + d : '');
      });
    });
  }

  /* ---------- Pixel ---------- */
  function loadPixel() {
    if (window.__emiPixelLoaded) return;
    if (!PIXEL_ID || PIXEL_ID === 'META_PIXEL_ID') return;   // noch keine ID hinterlegt
    window.__emiPixelLoaded = true;

    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */

    fbq('init', PIXEL_ID);
    var pvId = uuid();
    fbq('track', 'PageView', {}, { eventID: pvId });
    sendServer('PageView', pvId, {});
    flushQueue();
  }

  /* Events, die vor der Einwilligung passiert sind, werden NICHT
     nachgeschickt. Die Warteschlange existiert nur für Events, die
     im selben Klick nach dem Zustimmen ausgelöst werden. */
  var queue = [];
  function flushQueue() {
    while (queue.length) { var a = queue.shift(); track(a[0], a[1], a[2]); }
  }

  function track(name, params, eventID) {
    if (!granted()) return false;
    if (!window.fbq) { queue.push([name, params, eventID]); return false; }
    if (eventID) fbq('track', name, params || {}, { eventID: eventID });
    else fbq('track', name, params || {});
    return true;
  }

  function granted() { var c = read(); return !!(c && c.marketing); }

  /* ---------- Conversions API ---------- */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /* Pseudonyme Kennung dieses Browsers. Entsteht erst NACH der Einwilligung und
     wandert als client_reference_id mit zu Stripe, damit der spaetere Kauf demselben
     Besuch zugeordnet werden kann, ohne dass wir dafuer eine Mailadresse brauchen. */
  function cid() {
    if (!granted()) return null;
    try {
      var v = localStorage.getItem(CID_KEY);
      if (!v) { v = uuid(); localStorage.setItem(CID_KEY, v); }
      return v;
    } catch (e) { return null; }
  }

  function cookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : null;
  }

  /* Meta braucht _fbc fuer die Klick-Zuordnung. Es entsteht nur, wenn der Pixel
     beim Eintreffen mit ?fbclid= schon geladen war - nach dem Consent-Klick ist
     das oft nicht mehr der Fall, also bauen wir es notfalls selbst. */
  function fbc() {
    var c = cookie('_fbc');
    if (c) return c;
    var m = location.search.match(/[?&]fbclid=([^&]+)/);
    return m ? 'fb.1.' + Date.now() + '.' + m[1] : null;
  }

  function sendServer(name, eventID, params) {
    if (!granted()) return;
    var body = JSON.stringify({
      event_name: name,
      event_id: eventID,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: location.href,
      cid: cid(),
      fbp: cookie('_fbp'),
      fbc: fbc(),
      params: params || {}
    });
    try {
      /* text/plain haelt die Anfrage im "simple request"-Bereich. application/json macht
         sie preflight-pflichtig, und diesen CORS-Preflight schliesst sendBeacon beim
         Verlassen der Seite nicht zuverlaessig ab: der Aufruf gibt true zurueck, die
         Anfrage verlaesst den Browser aber nie. Zwischen dem 03.09.2026 und dem
         07.09.2026 kam so kein einziges Ereignis am Server an, bei 118 gezaehlten
         PageViews. Der Server parst den String, der Content-Type ist ihm egal.
         Der fetch greift jetzt auch, wenn sendBeacon false liefert - vorher hing er
         hinter else und lief nie, weil sendBeacon immer vorhanden ist. */
      var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      if (!(navigator.sendBeacon && navigator.sendBeacon(CAPI_ENDPOINT, blob))) {
        fetch(CAPI_ENDPOINT, { method: 'POST', body: body, keepalive: true,
                               headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
      }
    } catch (e) { /* Tracking darf die Seite nie kaputt machen */ }
  }

  /* Ein Event, zwei Wege, eine ID. */
  function trackBoth(name, params) {
    if (!granted()) return;
    var eventID = uuid();
    track(name, params, eventID);
    sendServer(name, eventID, params);
  }

  /* ---------- Banner ---------- */
  var el = null;

  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'cc';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Einwilligung in Marketing-Cookies');
    el.innerHTML =
      '<div class="cc-card">' +
        '<p class="cc-title">Kurz gefragt</p>' +
        '<p class="cc-text">Diese Seite kann den Meta-Pixel laden und dieselben ' +
        'Ereignisse zusätzlich über unseren Server an Meta übermitteln, damit Emi sieht, ' +
        'welche Anzeige dich hergebracht hat. Das passiert nur, wenn du zustimmst. ' +
        'Deine Entscheidung wird in deinem Browser gespeichert und du kannst sie jederzeit ' +
        'unten über „Cookie-Einstellungen" ändern. Mehr dazu in der ' +
        '<a href="datenschutz.html">Datenschutzerklärung</a>.</p>' +
        '<div class="cc-row">' +
          '<button type="button" class="btn btn-ghost cc-no">Ablehnen</button>' +
          '<button type="button" class="btn cc-yes">Akzeptieren</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.cc-yes').addEventListener('click', function () {
      write(true); hide(); loadPixel();
    });
    el.querySelector('.cc-no').addEventListener('click', function () {
      write(false); hide();
    });
    return el;
  }

  function show() { build().classList.add('cc-open'); }
  function hide() { if (el) el.classList.remove('cc-open'); }

  /* ---------- Öffentliche API ---------- */
  window.emiConsent = {
    track: track,
    granted: granted,
    reopen: function () {
      var was = granted();
      build();
      show();
      window.__emiConsentWasGranted = was;
    },
    /* Vom Fußzeilen-Link genutzt: Widerruf räumt auf und lädt neu. */
    revokeIfNeeded: function () {
      if (window.__emiConsentWasGranted && !granted()) {
        dropMetaCookies();
        try { localStorage.removeItem(CID_KEY); } catch (e) {}
        location.reload();
      }
    }
  };

  /* ---------- Start ---------- */
  function init() {
    var c = read();
    if (c === null) { show(); return; }
    if (c.marketing) loadPixel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  /* Fußzeilen-Link auf jeder Seite */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-consent-reopen]') : null;
    if (!t) return;
    e.preventDefault();
    window.emiConsent.reopen();
  });

  /* InitiateCheckout auf den Kauf-Klick. Stripes Hosted Checkout
     lässt keine Fremdskripte zu, also ist der Klick auf unserer
     eigenen Domain die Stelle, an der dieses Event entstehen kann. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('[data-checkout]') : null;
    if (!a) return;
    trackBoth('InitiateCheckout',
              { value: 130, currency: 'EUR', content_name: 'Mutterlinien 12.09.2026' });

    /* Die Kennung reist als client_reference_id mit zu Stripe. Der Stripe-Webhook
       schickt sie zurueck, und erst dadurch laesst sich der Kauf serverseitig
       demselben Besuch zuordnen. Ohne Einwilligung passiert das nicht. */
    var id = cid();
    if (id && a.href && a.href.indexOf('client_reference_id=') === -1) {
      a.href += (a.href.indexOf('?') === -1 ? '?' : '&') + 'client_reference_id=' + id;
    }
  });
})();
