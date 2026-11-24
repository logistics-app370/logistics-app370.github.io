/*
 * Logistics app: sign-in and the connection to the data line.
 * Holds no data. The sign-in token is kept only on this device (localStorage).
 */
(function () {
  'use strict';
  var CFG = window.LOGISTICS_CONFIG || {};
  var API_URL = String(CFG.apiUrl || '');
  var TOKEN_KEY = 'logistics:app:v1:token';
  var WHO_KEY = 'logistics:app:v1:who';
  var EMAIL_KEY = 'logistics:app:v1:email';
  var BOOT_KEY = 'logistics:app:v1:boot';
  var TIMEOUT_MS = 30000;
  var ACTIONS = {
    getBootstrap: 1, saveCount: 1, setQuantity: 1, markOrdered: 1, markReceived: 1,
    saveItem: 1, archiveItem: 1, addCategory: 1, setCategoryDefault: 1, addLocation: 1, addUnit: 1, updateVendor: 1
  };
  var started = false;

  // Deep link: ?item=ITM-1234 opens that item (same as the printed labels).
  (function () {
    var item = '';
    try { item = new URLSearchParams(location.search).get('item') || ''; } catch (err) { item = ''; }
    window.BOOT = { item: String(item).replace(/[^A-Za-z0-9\-]/g, '').slice(0, 32) };
    window.APP_ICON = 'icon-192.png';
  })();

  function store(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (err) {}
  }
  function load(key) { try { return localStorage.getItem(key); } catch (err) { return null; } }
  function token() { return load(TOKEN_KEY) || ''; }
  function who() { try { return JSON.parse(load(WHO_KEY) || 'null'); } catch (err) { return null; } }
  function setWho(w) {
    if (!w) return;
    store(WHO_KEY, JSON.stringify({ email: w.email || '', role: w.role || '', name: w.name || '' }));
    applyRole();
  }
  function applyRole() {
    var w = who();
    document.body.classList.toggle('role-counter', !!w && w.role !== 'Manager');
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function post(body, attempt) {
    attempt = attempt || 0;
    if (!API_URL) return Promise.reject(new Error('This test app is not connected yet.'));
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : 0;
    // text/plain keeps this a "simple" request, so no CORS preflight.
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('The data line answered ' + res.status + '.');
      return res.json();
    }).catch(function (err) {
      clearTimeout(timer);
      if (attempt < 2 && (!err || err.name === 'TypeError' || err.name === 'AbortError')) {
        return wait(700 * (attempt + 1)).then(function () { return post(body, attempt + 1); });
      }
      if (err && (err.name === 'TypeError' || err.name === 'AbortError')) throw new Error('No connection. Your change was not saved. Try again when you have signal.');
      throw err;
    });
  }

  function run(name, payload) {
    if (!ACTIONS[name]) return Promise.reject(new Error('That is not in the test version yet.'));
    var t = token();
    if (!t) { showSignIn('Please sign in.'); return Promise.reject(new Error('Please sign in.')); }
    return post({ action: name, token: t, payload: payload || {} }).then(function (res) {
      if (res && res.auth === false) {
        signOutLocal();
        showSignIn('Your sign-in ended. Enter your email to get a new code.');
        throw new Error('Please sign in again.');
      }
      if (res && res.who) setWho(res.who);
      return res;
    });
  }

  // ------------------------------------------------------------ sign-in screen

  function $(id) { return document.getElementById(id); }
  function msg(text, isError) {
    var el = $('auth-msg');
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }
  function busy(button, on, label) {
    button.disabled = on;
    if (label) button.textContent = label;
  }
  function showSignIn(message) {
    $('app').hidden = true;
    $('auth').hidden = false;
    $('auth-code-form').hidden = true;
    $('auth-email-form').hidden = false;
    $('auth-sub').textContent = 'Sign in with the email your manager added.';
    var last = load(EMAIL_KEY);
    if (last && !$('auth-email').value) $('auth-email').value = last;
    msg(API_URL ? (message || '') : 'This test app is not connected yet.', !API_URL);
  }
  function showCodeStep(email) {
    $('auth-email-form').hidden = true;
    $('auth-code-form').hidden = false;
    $('auth-sub').textContent = 'Check ' + email + ' for a 6-digit code.';
    $('auth-code').value = '';
    setTimeout(function () { try { $('auth-code').focus(); } catch (err) {} }, 30);
  }
  function deviceLabel() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    return 'Computer';
  }

  function requestCode(email) {
    var button = $('auth-send');
    busy(button, true, 'Sending…');
    msg('');
    return post({ action: 'requestCode', email: email }).then(function (res) {
      busy(button, false, 'Email me a code');
      if (!res.ok) { msg(res.error || 'Could not send a code.', true); return; }
      store(EMAIL_KEY, email);
      showCodeStep(email);
      msg(res.message || 'Code sent.');
    }).catch(function (err) {
      busy(button, false, 'Email me a code');
      msg(err.message || String(err), true);
    });
  }

  function verify() {
    var email = load(EMAIL_KEY) || $('auth-email').value.trim();
    var code = $('auth-code').value.replace(/\D/g, '');
    if (code.length !== 6) { msg('Enter the 6 digits from the email.', true); return; }
    var button = $('auth-verify');
    busy(button, true, 'Checking…');
    post({ action: 'verifyCode', email: email, code: code, device: deviceLabel() }).then(function (res) {
      busy(button, false, 'Sign in');
      if (!res.ok || !res.token) { msg(res.error || 'That code did not work.', true); $('auth-code').select(); return; }
      store(TOKEN_KEY, res.token);
      setWho({ email: res.email, role: res.role, name: res.name });
      msg('');
      showApp();
    }).catch(function (err) {
      busy(button, false, 'Sign in');
      msg(err.message || String(err), true);
    });
  }

  function bindAuth() {
    $('auth-email-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('auth-email').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('Enter your email address.', true); return; }
      requestCode(email);
    });
    $('auth-code-form').addEventListener('submit', function (e) { e.preventDefault(); verify(); });
    $('auth-code').addEventListener('input', function () {
      var v = this.value.replace(/\D/g, '').slice(0, 6);
      if (v !== this.value) this.value = v;
      if (v.length === 6) verify();
    });
    $('auth-resend').addEventListener('click', function () {
      var email = load(EMAIL_KEY);
      if (email) requestCode(email);
    });
    $('auth-change').addEventListener('click', function () { showSignIn(''); $('auth-email').focus(); });
    document.addEventListener('click', function (e) {
      var node = e.target && e.target.closest ? e.target.closest('[data-action="sign-out"]') : null;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      signOut();
    }, true);
  }

  function signOutLocal() {
    store(TOKEN_KEY, null);
    store(WHO_KEY, null);
    store(BOOT_KEY, null);
    document.body.classList.remove('role-counter');
  }

  function signOut() {
    var t = token();
    signOutLocal();
    if (t && API_URL) post({ action: 'signOut', token: t }).catch(function () {});
    location.replace(location.pathname);
  }

  function showApp() {
    $('auth').hidden = true;
    $('app').hidden = false;
    applyRole();
    if (!started && window.LogisticsApp) {
      started = true;
      window.LogisticsApp.start();
    } else if (window.LogisticsApp) {
      window.LogisticsApp.refresh();
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.LogisticsApi = {
    run: run,
    accountHtml: function () {
      var w = who() || {};
      return '<div class="card account-card"><h2>Signed in</h2><p class="who">' + esc(w.email || '') +
        (w.role ? ' · ' + esc(w.role) : '') + '</p><p class="hint">This phone stays signed in for about 90 days.</p>' +
        '<button class="secondary full" data-action="sign-out">Sign out</button></div>';
    },
    boot: function () {
      bindAuth();
      if (token() && API_URL) showApp();
      else showSignIn('');
    }
  };
})();
