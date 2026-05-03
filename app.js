/* Software Hub — vanilla JS app
 * - Завантажує software.json, малює картки, обробляє пошук, фільтри, тему.
 * - Без зовнішніх залежностей. Не використовує innerHTML для даних користувача.
 */

(function () {
  'use strict';

  /** Передвизначений порядок категорій для UI. */
  var DEFAULT_CATEGORIES = [
    'Усі',
    'Архіватори',
    'Браузери',
    'Комунікація',
    'Ігри',
    'Драйвери',
    'Утиліти',
    'Розробка',
    'Мультимедіа',
    'Безпека'
  ];

  /** @type {Array<Object>} */
  var ALL = [];
  var state = {
    query: '',
    category: 'Усі'
  };

  // -------------------------------------------------------------------------
  // Theme (3 states: 'system' | 'light' | 'dark')
  // -------------------------------------------------------------------------
  var THEME_KEY = 'software-hub:theme';
  var currentMode = 'system';
  var systemListener = null;
  /* matchMedia() returns a fresh MediaQueryList object on each call,
     so the same instance must be used to add and remove the listener. */
  var systemMQ = null;

  function getStoredTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch (e) { /* ignore */ }
    return null;
  }

  function storeTheme(mode) {
    try {
      if (mode === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, mode);
    } catch (e) { /* ignore */ }
  }

  function systemTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'dark';
    }
  }

  function effectiveTheme(mode) {
    return mode === 'system' ? systemTheme() : mode;
  }

  function applyTheme(mode) {
    var actual = effectiveTheme(mode);
    if (actual === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var icon = btn.querySelector('.theme-icon');
    var label = btn.querySelector('.theme-label');
    if (mode === 'light') {
      if (icon) icon.textContent = '☀️';
      if (label) label.textContent = 'Світла';
      btn.setAttribute('aria-label', 'Тема: світла. Натисни, щоб перемкнути на темну.');
    } else if (mode === 'dark') {
      if (icon) icon.textContent = '🌙';
      if (label) label.textContent = 'Темна';
      btn.setAttribute('aria-label', 'Тема: темна. Натисни, щоб перемкнути на авто (за системою).');
    } else {
      if (icon) icon.textContent = '🖥️';
      if (label) label.textContent = 'Авто';
      btn.setAttribute('aria-label', 'Тема: авто (за системою). Натисни, щоб перемкнути на світлу.');
    }
  }

  function attachSystemListener() {
    try {
      systemMQ = window.matchMedia('(prefers-color-scheme: dark)');
      systemListener = function () {
        if (currentMode === 'system') applyTheme('system');
      };
      if (systemMQ.addEventListener) systemMQ.addEventListener('change', systemListener);
      else if (systemMQ.addListener) systemMQ.addListener(systemListener);
    } catch (e) { /* ignore */ }
  }

  function detachSystemListener() {
    if (!systemListener || !systemMQ) return;
    try {
      if (systemMQ.removeEventListener) systemMQ.removeEventListener('change', systemListener);
      else if (systemMQ.removeListener) systemMQ.removeListener(systemListener);
    } catch (e) { /* ignore */ }
    systemListener = null;
    systemMQ = null;
  }

  function setMode(mode) {
    currentMode = mode;
    storeTheme(mode);
    applyTheme(mode);
    detachSystemListener();
    if (mode === 'system') attachSystemListener();
  }

  function initTheme() {
    var stored = getStoredTheme();
    setMode(stored || 'system');

    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        var next =
          currentMode === 'system' ? 'light' :
          currentMode === 'light' ? 'dark' :
          'system';
        setMode(next);
      });
    }
  }

  // -------------------------------------------------------------------------
  // URL state (?q=...&cat=...)
  // -------------------------------------------------------------------------

  function readURLState() {
    try {
      var p = new URLSearchParams(window.location.search);
      var q = p.get('q');
      var cat = p.get('cat');
      if (q) state.query = String(q).trim();
      if (cat) state.category = String(cat);
    } catch (e) { /* ignore */ }
  }

  function writeURLState() {
    try {
      var p = new URLSearchParams();
      if (state.query) p.set('q', state.query);
      if (state.category && state.category !== 'Усі') p.set('cat', state.category);
      var qs = p.toString();
      var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, '', url);
    } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Безпечний URL: дозволяємо лише http(s). Інакше — null. */
  function safeUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    var trimmed = url.trim();
    if (!trimmed) return null;
    var lower = trimmed.toLowerCase();
    if (lower.indexOf('http://') === 0 || lower.indexOf('https://') === 0) {
      return trimmed;
    }
    return null;
  }

  /** Створює DOM-вузол з тексту/атрибутів. Без innerHTML — захист від XSS. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') {
          node.className = v;
        } else if (k === 'text') {
          node.textContent = String(v);
        } else if (k === 'dataset' && typeof v === 'object') {
          for (var dk in v) {
            if (Object.prototype.hasOwnProperty.call(v, dk)) {
              node.dataset[dk] = String(v[dk]);
            }
          }
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null) continue;
        if (typeof c === 'string') {
          node.appendChild(document.createTextNode(c));
        } else {
          node.appendChild(c);
        }
      }
    }
    return node;
  }

  function tagKind(tagText) {
    var t = String(tagText).toLowerCase();
    if (t === 'windows') return 'os-windows';
    if (t === 'linux') return 'os-linux';
    if (t === 'open source') return 'open-source';
    if (t === 'free') return 'free';
    return null;
  }

  function declensionPrograms(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'програма';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'програми';
    return 'програм';
  }

  /** Локативний відмінок для "категоріях" / "категорії": "у X категоріях", "у 1 категорії". */
  function categoriesLocative(n) {
    return n === 1 ? 'категорії' : 'категоріях';
  }

  /** Розбиває текст на текстові вузли + <mark> для підсвічування пошукового запиту. */
  function buildHighlighted(text, query) {
    var s = String(text == null ? '' : text);
    if (!query || !s) return [document.createTextNode(s)];
    var lower = s.toLowerCase();
    var q = query.toLowerCase();
    var nodes = [];
    var i = 0;
    while (i < s.length) {
      var idx = lower.indexOf(q, i);
      if (idx === -1) {
        nodes.push(document.createTextNode(s.slice(i)));
        break;
      }
      if (idx > i) nodes.push(document.createTextNode(s.slice(i, idx)));
      var mark = document.createElement('mark');
      mark.textContent = s.slice(idx, idx + q.length);
      nodes.push(mark);
      i = idx + q.length;
    }
    return nodes;
  }

  function appendHighlighted(parent, text, query) {
    var nodes = buildHighlighted(text, query);
    for (var i = 0; i < nodes.length; i++) parent.appendChild(nodes[i]);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function renderCategories(categoriesFromData) {
    var host = document.getElementById('categories');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    /* Лічильники: всього + по кожній категорії (без врахування пошуку — інакше
       лічильник у фільтрі плутав би: "Браузери (0)" коли запит звужений). */
    var counts = Object.create(null);
    counts['Усі'] = ALL.length;
    ALL.forEach(function (it) {
      if (it && it.category) counts[it.category] = (counts[it.category] || 0) + 1;
    });

    var seen = Object.create(null);
    var list = [];
    for (var i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      var c = DEFAULT_CATEGORIES[i];
      if (!seen[c]) {
        seen[c] = true;
        list.push(c);
      }
    }
    for (var j = 0; j < categoriesFromData.length; j++) {
      var d = categoriesFromData[j];
      if (d && !seen[d]) {
        seen[d] = true;
        list.push(d);
      }
    }

    list.forEach(function (cat) {
      var n = counts[cat] || 0;
      var labelText = cat + ' (' + n + ')';
      var btn = el(
        'button',
        {
          type: 'button',
          class: 'cat-btn' + (cat === state.category ? ' is-active' : ''),
          'aria-pressed': cat === state.category ? 'true' : 'false',
          'data-cat': cat,
          text: labelText
        },
        null
      );
      btn.addEventListener('click', function () {
        state.category = cat;
        var btns = host.querySelectorAll('.cat-btn');
        for (var k = 0; k < btns.length; k++) {
          var b = btns[k];
          var isActive = b.getAttribute('data-cat') === cat;
          b.classList.toggle('is-active', isActive);
          b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
        renderCards();
        writeURLState();
      });
      host.appendChild(btn);
    });
  }

  function buildCard(item) {
    var card = el('article', { class: 'card' });

    var head = el('div', { class: 'card-head' });
    var title = el('h2', { class: 'card-title' });
    appendHighlighted(title, item.name, state.query);
    head.appendChild(title);
    if (item.category) {
      head.appendChild(el('span', { class: 'card-category', text: item.category }));
    }
    card.appendChild(head);

    if (item.description) {
      var desc = el('p', { class: 'card-description' });
      appendHighlighted(desc, item.description, state.query);
      card.appendChild(desc);
    }

    if (Array.isArray(item.tags) && item.tags.length) {
      var tagWrap = el('div', { class: 'card-tags' });
      item.tags.forEach(function (t) {
        var kind = tagKind(t);
        var attrs = {
          type: 'button',
          class: 'tag',
          text: t,
          'aria-label': 'Шукати за тегом: ' + t,
          title: 'Шукати за тегом: ' + t
        };
        if (kind) attrs['data-kind'] = kind;
        var tagBtn = el('button', attrs);
        tagBtn.addEventListener('click', function () {
          var input = document.getElementById('search');
          if (input) {
            input.value = t;
            input.focus();
          }
          state.query = t;
          renderCards();
          writeURLState();
        });
        tagWrap.appendChild(tagBtn);
      });
      card.appendChild(tagWrap);
    }

    var actions = el('div', { class: 'card-actions' });
    var dl = safeUrl(item.download);
    if (dl) {
      actions.appendChild(
        el('a', {
          class: 'btn btn--primary',
          href: dl,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Завантажити'
        })
      );
    }
    var web = safeUrl(item.website);
    if (web && web !== dl) {
      actions.appendChild(
        el('a', {
          class: 'btn',
          href: web,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Офіційний сайт'
        })
      );
    }
    var guide = safeUrl(item.guide);
    if (guide) {
      actions.appendChild(
        el('a', {
          class: 'btn',
          href: guide,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Інструкція'
        })
      );
    }
    if (actions.childNodes.length) {
      card.appendChild(actions);
    }
    return card;
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    var hay = [item.name, item.description, item.category];
    if (Array.isArray(item.tags)) hay = hay.concat(item.tags);
    for (var i = 0; i < hay.length; i++) {
      if (hay[i] && String(hay[i]).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  function renderCards() {
    var host = document.getElementById('cards');
    var emptyState = document.getElementById('empty-state');
    var counter = document.getElementById('results-count');
    if (!host) return;

    var filtered = ALL.filter(function (item) {
      if (state.category !== 'Усі' && item.category !== state.category) return false;
      return matchesQuery(item, state.query);
    });

    while (host.firstChild) host.removeChild(host.firstChild);

    if (filtered.length === 0) {
      if (emptyState) emptyState.hidden = false;
    } else {
      if (emptyState) emptyState.hidden = true;
      var frag = document.createDocumentFragment();
      filtered
        .slice()
        .sort(function (a, b) {
          return String(a.name).localeCompare(String(b.name), 'uk');
        })
        .forEach(function (item) {
          frag.appendChild(buildCard(item));
        });
      host.appendChild(frag);
    }

    if (counter) {
      counter.textContent =
        'Знайдено: ' + filtered.length + ' ' + declensionPrograms(filtered.length);
    }
  }

  function updateFooterStats() {
    var stats = document.getElementById('footer-stats');
    if (!stats) return;
    if (!ALL.length) {
      stats.textContent = '';
      return;
    }
    var cats = Object.create(null);
    ALL.forEach(function (it) {
      if (it && it.category) cats[it.category] = true;
    });
    var nCats = Object.keys(cats).length;
    stats.textContent =
      ' · ' + ALL.length + ' ' + declensionPrograms(ALL.length) +
      ' у ' + nCats + ' ' + categoriesLocative(nCats);
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this;
      var args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn.apply(ctx, args);
      }, wait);
    };
  }

  function bindSearch() {
    var input = document.getElementById('search');
    if (!input) return;
    if (state.query) input.value = state.query;
    var apply = debounce(function () {
      renderCards();
      writeURLState();
    }, 150);
    input.addEventListener('input', function () {
      state.query = input.value.trim();
      apply();
    });
  }

  /** "/" або Ctrl/Cmd+K — фокус у пошук. Esc у пошуку — очистити поле. */
  function bindHotkeys() {
    document.addEventListener('keydown', function (e) {
      var input = document.getElementById('search');
      if (!input) return;
      var target = e.target;
      var inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (!inField && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault();
        input.focus();
        input.select();
        return;
      }

      if (e.key === 'Escape' && document.activeElement === input) {
        if (input.value) {
          e.preventDefault();
          input.value = '';
          state.query = '';
          renderCards();
          writeURLState();
        } else {
          input.blur();
        }
      }
    });
  }

  function showError() {
    var err = document.getElementById('error-state');
    if (err) err.hidden = false;
  }

  function loadData() {
    return fetch('software.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error('Invalid software.json: expected array');
        ALL = data.filter(function (x) {
          return x && typeof x === 'object' && typeof x.name === 'string';
        });
        var cats = [];
        var seen = Object.create(null);
        ALL.forEach(function (it) {
          if (it.category && !seen[it.category]) {
            seen[it.category] = true;
            cats.push(it.category);
          }
        });
        renderCategories(cats);
        renderCards();
        updateFooterStats();
      })
      .catch(function (err) {
        if (window && window.console) console.error('[software-hub] failed to load data', err);
        showError();
      });
  }

  function init() {
    readURLState();
    initTheme();
    bindSearch();
    bindHotkeys();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
