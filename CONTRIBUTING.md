# Contributing

Дякую за інтерес. Це особистий каталог корисного софту, але PR-и приймаються — особливо для додавання нових позицій у `software.json` або виправлення мертвих посилань.

## Локальний запуск

```bash
git clone https://github.com/zagordenis/mysitesoft.git
cd mysitesoft
python3 -m http.server 8080
# відкрий http://localhost:8080
```

Жодних залежностей, бандлера, Node.js не потрібно — це чистий статичний сайт.

## Структура

```
.
├── index.html        — UI skeleton
├── style.css         — стилі (CSS variables, dark/light)
├── app.js            — логіка (vanilla JS, без фреймворків)
├── software.json     — каталог програм
├── .schema/
│   └── software.schema.json   — JSON Schema для валідації
├── .github/
│   ├── workflows/             — CI (GitHub Pages deploy + schema validation)
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
└── README.md
```

## Як додати нову програму

1. Відкрий `software.json`.
2. Додай новий об'єкт у кінець масиву:

   ```json
   {
     "name": "Example",
     "category": "Утиліти",
     "description": "Короткий опис, 1–2 речення.",
     "download": "https://example.com/download",
     "website": "https://example.com/",
     "guide": "",
     "tags": ["Windows", "Linux", "Free", "Open Source"],
     "license": "open-source",
     "lastChecked": "2026-05-03"
   }
   ```

3. Збережи й перевір локально, що JSON валідний:

   ```bash
   python3 -c "import json; json.load(open('software.json'))"
   ```

4. Опційно — прогони ту саму валідацію, що й CI:

   ```bash
   pip install 'jsonschema[format]==4.23.0'
   python3 -c "
   import json
   from jsonschema import Draft202012Validator, FormatChecker
   schema = json.load(open('.schema/software.schema.json'))
   data = json.load(open('software.json'))
   v = Draft202012Validator(schema, format_checker=FormatChecker())
   errs = list(v.iter_errors(data))
   print('OK' if not errs else f'FAIL: {[e.message for e in errs]}')
   "
   ```

5. Відкрий PR — workflow `Validate software.json` запуститься автоматично і перевірить структуру.

## Поля програми

| Поле          | Обов'язкове | Тип            | Опис |
|---------------|-------------|----------------|------|
| `name`        | так         | string (1–100) | Назва програми |
| `category`    | так         | string (1–50)  | Одна категорія. Нова категорія з'явиться у фільтрах автоматично. |
| `description` | так         | string (1–500) | Короткий опис (1–2 речення українською). |
| `download`    | так         | http(s) URL    | Пряме посилання на офіційне завантаження. |
| `website`     | ні          | http(s) URL або `""` | Офіційний сайт (якщо відрізняється від download). |
| `guide`       | ні          | http(s) URL або `""` | Документація / гайд. |
| `tags`        | так         | масив 1–12 рядків | Теги (ОС, ліцензія, тематика). |
| `license`     | ні          | enum           | `free`, `open-source`, `proprietary`, `trial`, `freemium` |
| `lastChecked` | ні          | дата `YYYY-MM-DD` | Дата останньої ручної перевірки `download` URL. |

## Категорії

Поточні: **Архіватори**, **Браузери**, **Комунікація**, **Ігри**, **Драйвери**, **Утиліти**, **Розробка**, **Мультимедіа**, **Безпека**.

Нову категорію можна додати — вона з'явиться у фільтрах автоматично, якщо хоча б одна програма її використовує.

## Теги

- **ОС-теги** (керують фільтром "ОС"): `Windows`, `Linux`, `macOS`, `Android`.
- **Ліцензійні теги** (відображаються в картці): `Free`, `Open Source`, `Trial`.
- **Тематичні**: `Editor`, `Browser`, `Antivirus`, `Torrent`, `Voice`, `Streaming`, `IDE`, `VCS`, `Games` тощо — короткі, релевантні.

## Що НЕ приймається

- Піратський, зламаний або keygen-софт
- Посилання на ad-spam агрегатори
- Сторонні CDN, бандлери, фреймворки (сайт залишається static + vanilla JS)
- Залежності від Node.js / npm у продакшен-зборці
- Логін, бекенд, API-ключі, аналітика

## Style guide для коду

- HTML5 / CSS3 / Vanilla JavaScript у ES5-стилі (`var`, `function`, без arrow / `let` / `const` / деструктуризації — для сумісності зі старими браузерами)
- Без `innerHTML` для даних користувача — лише `createElement` + `textContent`
- Зовнішні посилання: `target="_blank"` + `rel="noopener noreferrer"`
- CSS: змінні в `:root`, `--color-*`, `--space-*`; уникай магічних чисел
- Тестуй у Chrome і Firefox (мінімум)

## CI

- **`Deploy to GitHub Pages`** — деплоїть статичні файли при push у `main`
- **`Validate software.json`** — перевіряє `software.json` проти `.schema/software.schema.json` на кожному PR, що зачіпає JSON або схему
