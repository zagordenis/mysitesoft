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
  // Theme
  // -------------------------------------------------------------------------
  var THEME_KEY = 'software-hub:theme';

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* ignore */
    }
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      var icon = btn.querySelector('.theme-icon');
      var label = btn.querySelector('.theme-label');
      if (theme === 'light') {
        if (icon) icon.textContent = '☀️';
        if (label) label.textContent = 'Світла';
        btn.setAttribute('aria-label', 'Перемкнути на темну тему');
      } else {
        if (icon) icon.textContent = '🌙';
        if (label) label.textContent = 'Темна';
        btn.setAttribute('aria-label', 'Перемкнути на світлу тему');
      }
    }
  }

  function initTheme() {
    var stored = getStoredTheme();
    var theme;
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else {
      theme = 'dark';
    }
    applyTheme(theme);

    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        var next = current === 'light' ? 'dark' : 'light';
        applyTheme(next);
        storeTheme(next);
      });
    }
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

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function renderCategories(categoriesFromData) {
    var host = document.getElementById('categories');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

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
      var btn = el(
        'button',
        {
          type: 'button',
          class: 'cat-btn' + (cat === state.category ? ' is-active' : ''),
          role: 'tab',
          'aria-selected': cat === state.category ? 'true' : 'false',
          'data-cat': cat,
          text: cat
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
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }
        renderCards();
      });
      host.appendChild(btn);
    });
  }

  function buildCard(item) {
    var card = el('article', { class: 'card' });

    var head = el('div', { class: 'card-head' });
    head.appendChild(el('h2', { class: 'card-title', text: item.name }));
    if (item.category) {
      head.appendChild(el('span', { class: 'card-category', text: item.category }));
    }
    card.appendChild(head);

    if (item.description) {
      card.appendChild(el('p', { class: 'card-description', text: item.description }));
    }

    if (Array.isArray(item.tags) && item.tags.length) {
      var tagWrap = el('div', { class: 'card-tags' });
      item.tags.forEach(function (t) {
        var kind = tagKind(t);
        var attrs = { class: 'tag', text: t };
        if (kind) attrs['data-kind'] = kind;
        tagWrap.appendChild(el('span', attrs));
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

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function bindSearch() {
    var input = document.getElementById('search');
    if (!input) return;
    input.addEventListener('input', function () {
      state.query = input.value.trim();
      renderCards();
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
      })
      .catch(function (err) {
        // Логуємо у консоль — для розробника. Користувач бачить дружнє повідомлення.
        if (window && window.console) console.error('[software-hub] failed to load data', err);
        showError();
      });
  }

  function init() {
    initTheme();
    bindSearch();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
