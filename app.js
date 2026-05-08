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
    sort: DEFAULT_SORT,
    favOnly: false
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

  /** Повертає функцію, що видає унікальний slug у межах одного рендеру.
   * Object.create(null) — щоб назва на кшталт "Constructor" не колізіонувала
   * з Object.prototype.constructor через прототипну спадковість. */
  function makeSlugAllocator() {
    var seen = Object.create(null);
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
  // Favorites — persisted as lowercased item.name in localStorage
  // -------------------------------------------------------------------------
  var FAV_KEY = 'software-hub:favorites';
  /* Object.create(null) — щоб ключі типу "constructor" / "toString" не
     колізіонували з властивостями Object.prototype при is-fav перевірці. */
  var favorites = Object.create(null);

  function favKey(name) {
    return String(name == null ? '' : name).toLowerCase().trim();
  }

  function loadFavorites() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      if (!raw) return;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      favorites = Object.create(null);
      for (var i = 0; i < list.length; i++) {
        var k = list[i];
        if (typeof k === 'string' && k) favorites[k.toLowerCase().trim()] = true;
      }
    } catch (e) { /* ignore — невалідне сховище = пустий стан */ }
  }

  function saveFavorites() {
    try {
      var keys = [];
      for (var k in favorites) {
        if (Object.prototype.hasOwnProperty.call(favorites, k)) keys.push(k);
      }
      localStorage.setItem(FAV_KEY, JSON.stringify(keys));
    } catch (e) { /* ignore — privacy mode / quota */ }
  }

  function isFav(name) { return Boolean(favorites[favKey(name)]); }

  function toggleFav(name) {
    var k = favKey(name);
    if (!k) return false;
    if (favorites[k]) delete favorites[k];
    else favorites[k] = true;
    saveFavorites();
    return Boolean(favorites[k]);
  }

  /** Кількість збережених обраних, які реально присутні в каталозі. */
  function favCountInCatalog() {
    var n = 0;
    for (var i = 0; i < ALL.length; i++) {
      if (ALL[i] && ALL[i].name && isFav(ALL[i].name)) n++;
    }
    return n;
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
      var fav = p.get('fav');
      if (q) state.query = String(q).trim();
      if (fav === '1') state.favOnly = true;
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
      if (state.favOnly) p.set('fav', '1');
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

  /** Кнопка-зірка, яку можна вставити в head картки (compact) або модалку.
   *  Перемальовує картки, якщо активний favOnly-фільтр (інакше прибрана з обраних
   *  картка не зникає миттєво з відфільтрованої вибірки). */
  function buildFavButton(item, opts) {
    var compact = !!(opts && opts.compact);
    var on = isFav(item.name);
    var btn = el('button', {
      type: 'button',
      class: 'fav-btn' + (compact ? ' fav-btn--compact' : '') + (on ? ' is-on' : ''),
      'aria-pressed': on ? 'true' : 'false',
      'aria-label': (on ? 'Прибрати з обраних: ' : 'Додати в обране: ') + item.name,
      title: on ? 'Прибрати з обраних' : 'Додати в обране'
    });
    btn.appendChild(el('span', { 'aria-hidden': 'true', text: on ? '★' : '☆' }));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nowOn = toggleFav(item.name);
      btn.classList.toggle('is-on', nowOn);
      btn.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
      btn.setAttribute('aria-label', (nowOn ? 'Прибрати з обраних: ' : 'Додати в обране: ') + item.name);
      btn.setAttribute('title', nowOn ? 'Прибрати з обраних' : 'Додати в обране');
      var span = btn.firstChild;
      if (span) span.textContent = nowOn ? '★' : '☆';
      /* Якщо ми у favOnly-режимі, треба прибрати картку з сітки.
         У будь-якому випадку оновлюємо лічильник у toolbar. */
      if (state.favOnly) renderCards();
      else updateFavToggleUI();
    });
    return btn;
  }

  // -------------------------------------------------------------------------
  // Loading skeleton — показуємо до того, як завантажиться software.json
  // -------------------------------------------------------------------------
  function buildSkeletonCard() {
    var card = el('div', { class: 'card card--skeleton', 'aria-hidden': 'true' });
    card.appendChild(el('div', { class: 'sk-line sk-line--title' }));
    card.appendChild(el('div', { class: 'sk-line sk-line--cat' }));
    card.appendChild(el('div', { class: 'sk-line sk-line--text' }));
    card.appendChild(el('div', { class: 'sk-line sk-line--text sk-line--text-2' }));
    var skTags = el('div', { class: 'sk-tags' });
    for (var i = 0; i < 3; i++) skTags.appendChild(el('div', { class: 'sk-tag' }));
    card.appendChild(skTags);
    var skActions = el('div', { class: 'sk-actions' });
    skActions.appendChild(el('div', { class: 'sk-btn' }));
    skActions.appendChild(el('div', { class: 'sk-btn sk-btn--ghost' }));
    card.appendChild(skActions);
    return card;
  }

  function renderSkeletons(n) {
    var host = document.getElementById('cards');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    var counter = document.getElementById('results-count');
    if (counter) counter.textContent = 'Завантаження…';
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.hidden = true;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) frag.appendChild(buildSkeletonCard());
    host.appendChild(frag);
  }

  // -------------------------------------------------------------------------
  // Card modal (<dialog>)
  // -------------------------------------------------------------------------
  /* Тримаємо посилання на елемент, щоб не шукати його знову при кожному відкритті,
     і не падати, якщо HTML без діалогу (наприклад, у тестовому стуб-середовищі). */
  var modalEl = null;
  /* Куди повертати фокус після закриття. */
  var modalReturnFocus = null;

  function getModal() {
    if (!modalEl) modalEl = document.getElementById('card-modal');
    return modalEl;
  }

  function clearChildren(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function openCardModal(item) {
    var slug = item._slug;
    var modal = getModal();
    if (!modal) return;
    modalReturnFocus = document.activeElement;

    var titleEl = document.getElementById('modal-title');
    var metaEl = document.getElementById('modal-meta');
    var descEl = document.getElementById('modal-description');
    var tagsEl = document.getElementById('modal-tags');
    var actionsEl = document.getElementById('modal-actions');

    if (titleEl) {
      clearChildren(titleEl);
      titleEl.appendChild(document.createTextNode(String(item.name || '')));
    }

    if (metaEl) {
      clearChildren(metaEl);
      if (item.category) {
        metaEl.appendChild(el('span', { class: 'card-category', text: item.category }));
      }
      metaEl.appendChild(buildFavButton(item, { compact: false }));
      var permalink = el('a', {
        class: 'modal-permalink',
        href: '#card-' + slug,
        title: 'Прямий лінк',
        'aria-label': 'Прямий лінк на ' + item.name
      });
      permalink.appendChild(el('span', { 'aria-hidden': 'true', text: '#' }));
      permalink.appendChild(document.createTextNode(' permalink'));
      metaEl.appendChild(permalink);
    }

    if (descEl) {
      clearChildren(descEl);
      descEl.appendChild(document.createTextNode(String(item.description || '')));
    }

    if (tagsEl) {
      clearChildren(tagsEl);
      if (Array.isArray(item.tags) && item.tags.length) {
        item.tags.forEach(function (t) {
          var kind = tagKind(t);
          var icon = tagOsIcon(t);
          var attrs = { class: 'tag tag--static' };
          if (kind) attrs['data-kind'] = kind;
          var span = el('span', attrs);
          if (icon) span.appendChild(el('span', { class: 'tag-icon', 'aria-hidden': 'true', text: icon }));
          span.appendChild(document.createTextNode(t));
          tagsEl.appendChild(span);
        });
      }
    }

    if (actionsEl) {
      clearChildren(actionsEl);
      var dl = safeUrl(item.download);
      if (dl) {
        actionsEl.appendChild(el('a', {
          class: 'btn btn--primary',
          href: dl,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Завантажити'
        }));
      }
      var web = safeUrl(item.website);
      if (web && web !== dl) {
        actionsEl.appendChild(el('a', {
          class: 'btn',
          href: web,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Офіційний сайт'
        }));
      }
      var guide = safeUrl(item.guide);
      if (guide) {
        actionsEl.appendChild(el('a', {
          class: 'btn',
          href: guide,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Інструкція'
        }));
      }
    }

    /* Native <dialog> — тримає focus trap, Esc, inert background.
       Якщо браузер старий і showModal не підтримується — open + ручний фокус. */
    if (typeof modal.showModal === 'function' && !modal.open) {
      try { modal.showModal(); }
      catch (e) { modal.setAttribute('open', ''); }
    } else if (!modal.hasAttribute('open')) {
      modal.setAttribute('open', '');
    }
    var closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeCardModal() {
    var modal = getModal();
    if (!modal) return;
    if (typeof modal.close === 'function' && modal.open) {
      try { modal.close(); }
      catch (e) { modal.removeAttribute('open'); }
    } else {
      modal.removeAttribute('open');
    }
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') {
      try { modalReturnFocus.focus(); } catch (e) { /* ignore */ }
    }
    modalReturnFocus = null;
  }

  /** Прив'язує кнопку закриття + клік-на-бекдроп + close-event для <dialog>. */
  function bindModal() {
    var modal = getModal();
    if (!modal) return;
    var closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeCardModal);
    /* Клік на бекдроп: <dialog>::backdrop отримує події на самому dialog,
       а внутрішній .modal-card — ні. Тож event.target === dialog → це бекдроп. */
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeCardModal();
    });
    /* Native cancel (Esc) → закриваємо чисто, щоб повернути фокус. */
    modal.addEventListener('cancel', function (e) {
      e.preventDefault();
      closeCardModal();
    });
  }

  function buildCard(item) {
    var slug = item._slug;
    var card = el('article', { class: 'card', id: 'card-' + slug });

    var head = el('div', { class: 'card-head' });

    /* Заголовок-кнопка: клік відкриває модалку з повними деталями.
       <h2> залишається для семантики/SEO, <button> усередині — для активації. */
    var title = el('h2', { class: 'card-title' });
    var titleBtn = el('button', {
      type: 'button',
      class: 'card-title-btn',
      'aria-haspopup': 'dialog',
      'aria-label': 'Деталі: ' + item.name
    });
    appendHighlighted(titleBtn, item.name, state.query);
    titleBtn.addEventListener('click', function () { openCardModal(item); });
    title.appendChild(titleBtn);
    head.appendChild(title);

    var meta = el('div', { class: 'card-head-meta' });
    if (item.category) {
      meta.appendChild(el('span', { class: 'card-category', text: item.category }));
    }

    /* ★ — toggle "обране". Перемикає клас + перемальовує картки, якщо
       активний favOnly-фільтр (інакше натиснута зірка не зникає миттєво). */
    var favBtn = buildFavButton(item, { compact: true });
    meta.appendChild(favBtn);

    /* Прямий лінк на картку: натискання змінює hash, правий клік → копіювати лінк. */
    var permalink = el('a', {
      class: 'card-permalink',
      href: '#card-' + slug,
      title: 'Прямий лінк',
      'aria-label': 'Прямий лінк на ' + item.name
    });
    permalink.appendChild(el('span', { 'aria-hidden': 'true', text: '#' }));
    meta.appendChild(permalink);

    head.appendChild(meta);
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
      if (state.favOnly && !isFav(item.name)) return false;
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
        .sort(function (a, b) { return compareCards(a, b, state.sort); })
        .forEach(function (item) {
          frag.appendChild(buildCard(item));
        });
      host.appendChild(frag);
    }

    if (counter) {
      counter.textContent =
        'Знайдено: ' + filtered.length + ' ' + declensionPrograms(filtered.length);
    }

    updateResetVisibility();
    updateFavToggleUI();
    updateDocumentTitle(filtered.length);
  }

  /** Динамічний <title> з активних фільтрів — для шарингу/закладок. */
  function updateDocumentTitle(count) {
    var parts = [];
    if (state.favOnly) parts.push('обране');
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
      (state.sort && state.sort !== DEFAULT_SORT) ||
      state.favOnly
    );
  }

  function updateResetVisibility() {
    var btn = document.getElementById('reset-filters');
    if (!btn) return;
    btn.hidden = !hasActiveFilters();
  }

  /** Синхронізує стан кнопки "Тільки обране" з state + лічильником. */
  function updateFavToggleUI() {
    var btn = document.getElementById('fav-toggle');
    if (!btn) return;
    var icon = btn.querySelector('.fav-toggle-icon');
    var counter = document.getElementById('fav-count');
    btn.setAttribute('aria-pressed', state.favOnly ? 'true' : 'false');
    btn.classList.toggle('is-active', state.favOnly);
    if (icon) icon.textContent = state.favOnly ? '★' : '☆';
    if (counter) {
      var n = favCountInCatalog();
      counter.textContent = n ? '(' + n + ')' : '';
    }
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

    var favToggle = document.getElementById('fav-toggle');
    if (favToggle) {
      favToggle.addEventListener('click', function () {
        state.favOnly = !state.favOnly;
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
        state.favOnly = false;

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
        /* Стабільні slug-и: обчислюємо один раз після завантаження, у
           фіксованому порядку (alpha-sort за name). Так id картки і hash
           permalink не змінюються при зміні фільтрів / сортування. */
        var allocSlug = makeSlugAllocator();
        ALL.slice()
          .sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), 'uk');
          })
          .forEach(function (it) { it._slug = allocSlug(it.name); });
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
        /* Прибираємо скелетони — інакше вони триватимуть нескінченну анімацію
           поверх повідомлення про помилку. */
        var host = document.getElementById('cards');
        if (host) {
          while (host.firstChild) host.removeChild(host.firstChild);
        }
        var counter = document.getElementById('results-count');
        if (counter) counter.textContent = '';
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
    loadFavorites();
    initTheme();
    bindSearch();
    bindFilters();
    bindHotkeys();
    bindHashChange();
    bindModal();
    /* Скелетон до старту fetch — позбавляємось від layout-shift і даємо
       зрозуміти користувачу, що сайт живий навіть на повільній мережі. */
    renderSkeletons(6);
    loadData();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
