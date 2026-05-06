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

  /** Дозволені значення для фільтрів (валідація URL + чекбоксів). */
  var VALID_OS = ['Windows', 'Linux', 'macOS', 'Android'];
  var VALID_SORT = ['name', 'category'];
  var DEFAULT_SORT = 'name';

  /** @type {Array<Object>} */
  var ALL = [];
  var state = {
    query: '',
    category: 'Усі',
    osFilter: [],
    sort: DEFAULT_SORT
  };

  var BASE_TITLE = 'Software Hub';

  /* Транслітерація укр. кирилиці → латиниця за чинним стандартом КМУ 55-2010
   * (для slug-ів, не для документів). Решта символів далі ремапиться через
   * `[^a-z0-9]+ → '-'`, тож тут потрібні лише відповідники для літер. */
  var UA_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e',
    'є': 'ie', 'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
    'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'iu', 'я': 'ia', '\'': '',
    'ё': 'e', 'ы': 'y', 'э': 'e', 'ъ': ''
  };

  /** Стійка ASCII-форма назви для id картки і hash-permalink.
   * Транслітерує кирилицю, зберігає знакові символи на кшталт `++`,
   * гарантує непорожній результат. Унікальність дублікатів — у renderCards. */
  function slugify(s) {
    var lower = String(s).toLowerCase();
    var out = '';
    for (var i = 0; i < lower.length; i++) {
      var ch = lower.charAt(i);
      if (UA_TRANSLIT.hasOwnProperty(ch)) {
        out += UA_TRANSLIT[ch];
      } else if (ch === '+') {
        out += '-plus';
      } else if (ch === '#') {
        out += '-sharp';
      } else {
        out += ch;
      }
    }
    out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return out || 'item';
  }

  /** Повертає функцію, що видає унікальний slug у межах одного рендеру. */
  function makeSlugAllocator() {
    var seen = {};
    return function (name) {
      var base = slugify(name);
      var slug = base;
      var n = 2;
      while (seen[slug]) {
        slug = base + '-' + n;
        n++;
      }
      seen[slug] = true;
      return slug;
    };
  }

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

  /* Завжди записуємо явне значення, щоб getStoredTheme() міг розрізнити
     "користувач сам обрав 'system'" і "ніколи не відкривав сайт". */
  function storeTheme(mode) {
    try {
      localStorage.setItem(THEME_KEY, mode);
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
    /* Дефолт — 'system': перший візит підхоплює системну тему через
       prefers-color-scheme. Користувач може перемкнути в light / dark і
       назад у system через 3-stateний тогл (див. кнопку нижче). */
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
      var sort = p.get('sort');
      var os = p.getAll('os');
      if (q) state.query = String(q).trim();
      /* Перша валідація — проти DEFAULT_CATEGORIES. Категорії з даних
         перевіряємо ще раз у renderCategories() після завантаження JSON. */
      if (cat) {
        var c = String(cat);
        if (DEFAULT_CATEGORIES.indexOf(c) !== -1) state.category = c;
        else state.pendingCategory = c;
      }
      if (sort && VALID_SORT.indexOf(sort) !== -1) state.sort = sort;
      if (os && os.length) {
        var picked = [];
        for (var i = 0; i < os.length; i++) {
          if (VALID_OS.indexOf(os[i]) !== -1 && picked.indexOf(os[i]) === -1) {
            picked.push(os[i]);
          }
        }
        state.osFilter = picked;
      }
    } catch (e) { /* ignore */ }
  }

  function writeURLState() {
    try {
      var p = new URLSearchParams();
      if (state.query) p.set('q', state.query);
      if (state.category && state.category !== 'Усі') p.set('cat', state.category);
      if (state.sort && state.sort !== DEFAULT_SORT) p.set('sort', state.sort);
      if (state.osFilter && state.osFilter.length) {
        for (var i = 0; i < state.osFilter.length; i++) p.append('os', state.osFilter[i]);
      }
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
    if (t === 'macos') return 'os-macos';
    if (t === 'android') return 'os-android';
    if (t === 'open source') return 'open-source';
    if (t === 'free') return 'free';
    return null;
  }

  /** Символ-іконка для OS-тегу (префікс у .tag), null якщо не OS. */
  function tagOsIcon(tagText) {
    var t = String(tagText).toLowerCase();
    if (t === 'windows') return '🪟';
    if (t === 'linux') return '🐧';
    if (t === 'macos') return '🍎';
    if (t === 'android') return '🤖';
    return null;
  }

  function declensionPrograms(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'програма';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'програми';
    return 'програм';
  }

  /** Локативний відмінок для "категоріях" / "категорії": "у X категоріях", "у 1 категорії".
   *  Та сама логіка mod10/mod100, що й у declensionPrograms — щоб 21, 31, 101 теж
   *  давали "категорії", а 11 — "категоріях". */
  function categoriesLocative(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'категорії';
    return 'категоріях';
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

    /* Друга валідація URL ?cat=…: якщо у readURLState() значення не співпало з
       DEFAULT_CATEGORIES, тут перевіряємо ще раз — раптом це категорія з даних
       (нова, не в дефолтному списку). Якщо не співпало — лишаємо 'Усі'. */
    if (state.pendingCategory) {
      if (seen[state.pendingCategory]) state.category = state.pendingCategory;
      delete state.pendingCategory;
      writeURLState();
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

  function buildCard(item, slug) {
    var card = el('article', { class: 'card', id: 'card-' + slug });

    var head = el('div', { class: 'card-head' });
    var title = el('h2', { class: 'card-title' });
    appendHighlighted(title, item.name, state.query);
    head.appendChild(title);
    if (item.category) {
      head.appendChild(el('span', { class: 'card-category', text: item.category }));
    }
    /* Прямий лінк на картку: натискання змінює hash, правий клік → копіювати лінк. */
    var permalink = el('a', {
      class: 'card-permalink',
      href: '#card-' + slug,
      title: 'Прямий лінк',
      'aria-label': 'Прямий лінк на ' + item.name
    });
    permalink.appendChild(el('span', { 'aria-hidden': 'true', text: '#' }));
    head.appendChild(permalink);
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
        var icon = tagOsIcon(t);
        var attrs = {
          type: 'button',
          class: 'tag',
          'aria-label': 'Шукати за тегом: ' + t,
          title: 'Шукати за тегом: ' + t
        };
        if (kind) attrs['data-kind'] = kind;
        var tagBtn = el('button', attrs);
        if (icon) {
          tagBtn.appendChild(el('span', { class: 'tag-icon', 'aria-hidden': 'true', text: icon }));
        }
        tagBtn.appendChild(document.createTextNode(t));
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

  /** OR-логіка: без вибору — все проходить; інакше треба хоча один збіг. */
  function matchesOS(item, osFilter) {
    if (!osFilter || !osFilter.length) return true;
    if (!Array.isArray(item.tags)) return false;
    var tagsLower = {};
    for (var i = 0; i < item.tags.length; i++) tagsLower[String(item.tags[i]).toLowerCase()] = true;
    for (var j = 0; j < osFilter.length; j++) {
      if (tagsLower[String(osFilter[j]).toLowerCase()]) return true;
    }
    return false;
  }

  function compareCards(a, b, sort) {
    var nameA = String(a.name || '');
    var nameB = String(b.name || '');
    if (sort === 'category') {
      var catA = String(a.category || '');
      var catB = String(b.category || '');
      var byCat = catA.localeCompare(catB, 'uk');
      if (byCat !== 0) return byCat;
    }
    return nameA.localeCompare(nameB, 'uk');
  }

  function renderCards() {
    var host = document.getElementById('cards');
    var emptyState = document.getElementById('empty-state');
    var counter = document.getElementById('results-count');
    if (!host) return;

    var filtered = ALL.filter(function (item) {
      if (state.category !== 'Усі' && item.category !== state.category) return false;
      if (!matchesOS(item, state.osFilter)) return false;
      return matchesQuery(item, state.query);
    });

    while (host.firstChild) host.removeChild(host.firstChild);

    if (filtered.length === 0) {
      if (emptyState) emptyState.hidden = false;
    } else {
      if (emptyState) emptyState.hidden = true;
      var frag = document.createDocumentFragment();
      var allocSlug = makeSlugAllocator();
      filtered
        .slice()
        .sort(function (a, b) { return compareCards(a, b, state.sort); })
        .forEach(function (item) {
          frag.appendChild(buildCard(item, allocSlug(item.name)));
        });
      host.appendChild(frag);
    }

    if (counter) {
      counter.textContent =
        'Знайдено: ' + filtered.length + ' ' + declensionPrograms(filtered.length);
    }

    updateResetVisibility();
    updateDocumentTitle(filtered.length);
  }

  /** Динамічний <title> з активних фільтрів — для шарингу/закладок. */
  function updateDocumentTitle(count) {
    var parts = [];
    if (state.category && state.category !== 'Усі') parts.push(state.category);
    if (state.query) parts.push('пошук: «' + state.query + '»');
    if (state.osFilter && state.osFilter.length) parts.push('ОС: ' + state.osFilter.join('+'));
    var title = BASE_TITLE;
    if (parts.length) {
      title = BASE_TITLE + ' — ' + parts.join(' · ');
      if (typeof count === 'number') title += ' (' + count + ')';
    }
    if (document.title !== title) document.title = title;
  }

  /** Скрол + підсвітка на 2с, якщо в URL є #card-<slug>. Поважає reduced-motion. */
  function focusHashTarget() {
    var hash = window.location.hash || '';
    if (hash.length < 2) return;
    var id = hash.slice(1);
    if (id.indexOf('card-') !== 0) return;
    var target = document.getElementById(id);
    if (!target || !target.classList.contains('card')) return;
    var reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    } catch (e) {
      target.scrollIntoView();
    }
    target.classList.add('is-highlighted');
    setTimeout(function () { target.classList.remove('is-highlighted'); }, 2000);
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

  /** Правда, якщо хоч якийсь фільтр активний або сорт не дефолтний. */
  function hasActiveFilters() {
    return Boolean(
      state.query ||
      (state.category && state.category !== 'Усі') ||
      (state.osFilter && state.osFilter.length) ||
      (state.sort && state.sort !== DEFAULT_SORT)
    );
  }

  function updateResetVisibility() {
    var btn = document.getElementById('reset-filters');
    if (!btn) return;
    btn.hidden = !hasActiveFilters();
  }

  function bindFilters() {
    var sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
      if (state.sort && VALID_SORT.indexOf(state.sort) !== -1) sortSelect.value = state.sort;
      sortSelect.addEventListener('change', function () {
        var v = sortSelect.value;
        if (VALID_SORT.indexOf(v) === -1) v = DEFAULT_SORT;
        state.sort = v;
        renderCards();
        writeURLState();
      });
    }

    var osBoxes = document.querySelectorAll('.os-filter input[type="checkbox"][name="os"]');
    for (var i = 0; i < osBoxes.length; i++) {
      var cb = osBoxes[i];
      if (state.osFilter.indexOf(cb.value) !== -1) cb.checked = true;
      cb.addEventListener('change', function () {
        var picked = [];
        var all = document.querySelectorAll('.os-filter input[type="checkbox"][name="os"]:checked');
        for (var k = 0; k < all.length; k++) {
          if (VALID_OS.indexOf(all[k].value) !== -1) picked.push(all[k].value);
        }
        state.osFilter = picked;
        renderCards();
        writeURLState();
      });
    }

    var resetBtn = document.getElementById('reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state.query = '';
        state.category = 'Усі';
        state.osFilter = [];
        state.sort = DEFAULT_SORT;

        var input = document.getElementById('search');
        if (input) input.value = '';
        if (sortSelect) sortSelect.value = DEFAULT_SORT;
        var allOs = document.querySelectorAll('.os-filter input[type="checkbox"][name="os"]');
        for (var m = 0; m < allOs.length; m++) allOs[m].checked = false;

        var catBtns = document.querySelectorAll('#categories .cat-btn');
        for (var n = 0; n < catBtns.length; n++) {
          var b = catBtns[n];
          var isAll = b.getAttribute('data-cat') === 'Усі';
          b.classList.toggle('is-active', isAll);
          b.setAttribute('aria-pressed', isAll ? 'true' : 'false');
        }

        renderCards();
        writeURLState();
        if (input) input.focus();
      });
    }
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

      /* Ctrl/Cmd+K — глобальний хоткей: працює навіть у полях вводу,
         бо це стандартна звичка "шукати" (як у Slack/Discord/GitHub).
         "/" — лише поза полями, інакше неможливо буде ввести слеш. */
      var isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      var isSlash = e.key === '/' && !inField;
      if (isCtrlK || isSlash) {
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
        /* Картки існують — тепер можна скролити до hash-цілі. */
        focusHashTarget();
      })
      .catch(function (err) {
        if (window && window.console) console.error('[software-hub] failed to load data', err);
        showError();
      });
  }

  function bindHashChange() {
    window.addEventListener('hashchange', focusHashTarget);
  }

  /* PWA: реєструємо service worker. Сам файл sw.js на тому ж origin, scope './'. */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        if (window && window.console) console.warn('[software-hub] SW registration failed', err);
      });
    });
  }

  function init() {
    readURLState();
    initTheme();
    bindSearch();
    bindFilters();
    bindHotkeys();
    bindHashChange();
    loadData();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
