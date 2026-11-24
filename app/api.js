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
    saveItem: 1, archiveItem: 1, addCategory: 1, setCategoryDefault: 1, addLocation: 1, addUnit: 1, updateVendor: 1,
    listUsers: 1, addUser: 1, removeUser: 1, signOutUser: 1, setUserRole: 1
  };
  var REFRESH_AFTER_MS = 45000;
  var started = false;
  var lastBootAt = 0;

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
    document.body.classList.toggle('role-manager', !!w && w.role === 'Manager');
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
      if (name === 'getBootstrap' && res && res.ok !== false) lastBootAt = Date.now();
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
      var node = e.target && e.target.closest ? e.target.closest('[data-action="sign-out"], [data-action="open-people"]') : null;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      if (node.getAttribute('data-action') === 'open-people') openPeople();
      else signOut();
    }, true);
    // Coming back to the app after a while: show what is saved, refresh quietly.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !started || !token()) return;
      if (Date.now() - lastBootAt > REFRESH_AFTER_MS && window.LogisticsApp) window.LogisticsApp.refresh();
    });
    window.addEventListener('online', function () {
      if (started && token() && window.LogisticsApp) window.LogisticsApp.refresh();
    });
  }

  function signOutLocal() {
    store(TOKEN_KEY, null);
    store(WHO_KEY, null);
    store(BOOT_KEY, null);
    document.body.classList.remove('role-manager');
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


  // ------------------------------------------------------------ People (Managers)

  var people = { users: [], max: 60, loading: false, busy: false, confirm: '', msg: '', error: false };

  function peopleEl() {
    var el = document.getElementById('people');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'people';
    el.className = 'people';
    el.hidden = true;
    el.addEventListener('click', onPeopleClick);
    el.addEventListener('submit', onPeopleSubmit);
    document.body.appendChild(el);
    return el;
  }

  function openPeople() {
    people.confirm = '';
    people.msg = '';
    peopleEl().hidden = false;
    document.body.classList.add('people-open');
    renderPeople();
    people.loading = true;
    run('listUsers', {}).then(function (res) {
      people.loading = false;
      if (res && res.ok) { people.users = res.users || []; people.max = res.max || 60; }
      else { people.msg = (res && res.error) || 'Could not load the list.'; people.error = true; }
      renderPeople();
    }).catch(function (err) {
      people.loading = false;
      people.msg = err.message || String(err);
      people.error = true;
      renderPeople();
    });
  }

  function closePeople() {
    peopleEl().hidden = true;
    document.body.classList.remove('people-open');
  }

  function renderPeople() {
    var el = peopleEl();
    var rows = people.users.map(function (u) {
      var label = u.name ? esc(u.name) : esc(u.email);
      var meta = (u.name ? esc(u.email) + ' · ' : '') + (u.devices ? u.devices + (u.devices === 1 ? ' phone' : ' phones') : 'not signed in') +
        (u.lastActive ? ' · last active ' + esc(u.lastActive.slice(0, 10)) : '');
      var badges = (u.owner ? '<span class="badge ok">Owner</span> ' : '') + (u.role === 'Manager' ? '<span class="badge ordered">Manager</span> ' : '') + (u.you ? '<span class="badge uncounted">You</span>' : '');
      var email = esc(u.email);
      function btn(kind, text, confirmText) {
        var key = kind + ':' + u.email;
        var asking = people.confirm === key;
        return '<button type="button" class="secondary' + (asking ? ' danger' : '') + '" data-people="' + kind + '" data-email="' + email + '"' + (people.busy ? ' disabled' : '') + '>' + (asking ? confirmText : text) + '</button>';
      }
      var actions = '';
      if (!u.owner) {
        actions += '<button type="button" class="secondary" data-people="role" data-email="' + email + '" data-role="' + (u.role === 'Manager' ? 'User' : 'Manager') + '"' + (people.busy ? ' disabled' : '') + '>' + (u.role === 'Manager' ? 'Make coworker' : 'Make manager') + '</button>';
      }
      actions += btn('signout', 'Sign out', 'Tap again to sign out');
      if (!u.owner && !u.you) actions += btn('remove', 'Remove', 'Tap again to remove');
      return '<li class="person"><div class="person-main"><strong>' + label + '</strong> ' + badges + '<div class="hint">' + meta + '</div></div><div class="person-actions">' + actions + '</div></li>';
    }).join('');
    el.innerHTML =
      '<div class="people-head"><button type="button" class="back" data-people="close" aria-label="Back">←</button><h1>People</h1></div>' +
      '<div class="people-body">' +
        '<p class="hint">Everyone on this list can count, mark orders, and add or edit items. Managers can also add and remove people. Adding someone does not send them an email. Tell them to open the app and enter their email.</p>' +
        '<form class="card people-add" id="people-add" novalidate><h2>Add a coworker</h2>' +
          '<div class="field"><label for="people-name">Name</label><input id="people-name" autocomplete="off" maxlength="60" placeholder="First and last name"></div>' +
          '<div class="field"><label for="people-email">Email</label><input id="people-email" type="email" inputmode="email" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="Their email address"></div>' +
          '<div class="field"><label for="people-role">Can</label><select id="people-role"><option value="User">Count, order, and edit items</option><option value="Manager">Also manage people (Manager)</option></select></div>' +
          '<button class="primary full" type="submit"' + (people.busy ? ' disabled' : '') + '>Add person</button></form>' +
        '<p class="people-msg' + (people.error ? ' error' : '') + '" role="status" aria-live="polite">' + esc(people.msg) + '</p>' +
        '<h2 class="group-title">' + (people.loading ? 'Loading…' : people.users.length + ' of ' + people.max + ' people') + '</h2>' +
        '<ul class="people-list">' + rows + '</ul>' +
      '</div>';
  }

  function peopleCall(action, payload, doneMsg) {
    people.busy = true;
    people.msg = '';
    people.error = false;
    renderPeople();
    return run(action, payload).then(function (res) {
      people.busy = false;
      if (res && res.ok) {
        people.users = res.users || people.users;
        people.msg = typeof doneMsg === 'function' ? doneMsg(res) : doneMsg;
        people.error = false;
        return true;
      }
      people.msg = (res && res.error) || 'That did not work.';
      people.error = true;
      return false;
    }).catch(function (err) {
      people.busy = false;
      people.msg = err.message || String(err);
      people.error = true;
      return false;
    }).then(function (ok) { renderPeople(); return ok; });
  }

  function onPeopleSubmit(e) {
    if (!e.target || e.target.id !== 'people-add') return;
    e.preventDefault();
    var email = document.getElementById('people-email').value.trim().toLowerCase();
    var name = document.getElementById('people-name').value.trim();
    var role = document.getElementById('people-role').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { people.msg = 'Enter their email address.'; people.error = true; renderPeople(); return; }
    if (!name) { people.msg = 'Add their name so the activity log is easy to read.'; people.error = true; renderPeople(); return; }
    peopleCall('addUser', { email: email, name: name, role: role }, 'Added ' + name + '.');
  }

  function onPeopleClick(e) {
    var node = e.target && e.target.closest ? e.target.closest('[data-people]') : null;
    if (!node || node.disabled) return;
    var kind = node.getAttribute('data-people');
    var email = node.getAttribute('data-email') || '';
    if (kind === 'close') { closePeople(); return; }
    if (kind === 'role') {
      people.confirm = '';
      var role = node.getAttribute('data-role');
      peopleCall('setUserRole', { email: email, role: role }, role === 'Manager' ? 'Now a manager.' : 'Now a coworker.');
      return;
    }
    var key = kind + ':' + email;
    if (people.confirm !== key) { people.confirm = key; renderPeople(); return; }
    people.confirm = '';
    if (kind === 'signout') {
      peopleCall('signOutUser', { email: email }, function (res) {
        return 'Signed out ' + (res.revoked || 0) + (res.revoked === 1 ? ' phone.' : ' phones.');
      });
    } else if (kind === 'remove') {
      peopleCall('removeUser', { email: email }, 'Removed. They are signed out and cannot sign in again.');
    }
  }

  window.LogisticsApi = {
    run: run,
    accountHtml: function () {
      var w = who() || {};
      return '<div class="card account-card"><h2>Signed in</h2><p class="who">' + esc(w.name ? w.name + ' · ' : '') + esc(w.email || '') +
        (w.role === 'Manager' ? ' · Manager' : '') + '</p><p class="hint">This phone stays signed in for about 90 days.</p>' +
        (w.role === 'Manager' ? '<button class="secondary full" data-action="open-people">People</button>' : '') +
        '<button class="secondary full" data-action="sign-out">Sign out</button></div>';
    },
    boot: function () {
      bindAuth();
      if (token() && API_URL) showApp();
      else showSignIn('');
    }
  };
})();
