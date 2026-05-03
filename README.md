# Software Hub

Маленький статичний каталог корисного софту, утиліт, лаунчерів, драйверів та інструментів для Windows / Linux. Лише посилання на офіційні джерела — без бекенду, без баз даних, без авторизації.

- HTML5 + CSS3 + Vanilla JavaScript
- `software.json` як «база даних»
- Темна / світла тема (зберігається в `localStorage`)
- Пошук за назвою, описом, категорією, тегами
- Фільтри категорій
- Адаптивний дизайн (телефон / планшет / ПК)
- Зовнішні посилання відкриваються в новій вкладці з `rel="noopener noreferrer"`

## Структура проєкту

```
software-hub/
├── index.html
├── style.css
├── app.js
├── software.json
├── README.md
├── .nojekyll               # GitHub Pages: вимикає Jekyll
├── .github/workflows/
│   └── pages.yml           # авто-деплой на GitHub Pages
└── assets/
    └── icons/
```

## Як додати нову програму

Відкрийте `software.json` і додайте об'єкт у масив. Формат:

```json
{
  "name": "7-Zip",
  "category": "Архіватори",
  "description": "Безкоштовний архіватор з відкритим кодом.",
  "download": "https://www.7-zip.org/",
  "website": "https://www.7-zip.org/",
  "guide": "",
  "tags": ["Windows", "Free", "Open Source", "Archive"]
}
```

Поля:

| Поле          | Тип        | Обов'язкове | Опис                                                                 |
|---------------|------------|-------------|----------------------------------------------------------------------|
| `name`        | `string`   | так         | Назва програми                                                       |
| `category`    | `string`   | так         | Категорія (одна з кнопок-фільтрів — або нова)                        |
| `description` | `string`   | так         | Короткий опис українською                                            |
| `download`    | `string`   | так         | Пряме посилання на сторінку завантаження (тільки `http(s)`)          |
| `website`     | `string`   | ні          | Офіційний сайт (якщо відрізняється від `download`)                   |
| `guide`       | `string`   | ні          | Посилання на офіційну документацію / інструкцію                      |
| `tags`        | `string[]` | ні          | Теги: `Windows`, `Linux`, `Free`, `Open Source`, `Trial` тощо        |

Категорії, які підтримуються «з коробки» (можна додавати свої — вони з'являться як кнопки автоматично):

- Усі
- Архіватори
- Браузери
- Комунікація
- Ігри
- Драйвери
- Утиліти
- Розробка
- Мультимедіа
- Безпека

> **Безпека.** URL з нестандартними схемами (наприклад, `javascript:`) ігноруються — кнопка просто не з'явиться. Завантажуйте програми тільки з офіційних сайтів.

## Запуск локально

Сайт — повністю статичний, але через `fetch('software.json')` його **не можна** відкрити подвійним кліком (`file://`). Потрібен будь-який локальний HTTP-сервер.

### Python 3

```bash
cd software-hub
python3 -m http.server 8080
```

Відкрийте `http://localhost:8080`.

### Альтернативи

```bash
# Node.js (npx, без встановлення)
npx --yes serve -l 8080 .

# PHP (вбудований сервер)
php -S localhost:8080
```

## Розгортання через GitHub Pages

У репо вже налаштовано workflow `.github/workflows/pages.yml`, який автоматично публікує сайт після кожного push у `main`.

**Перше підключення:**

1. У GitHub перейди в **Settings → Pages**.
2. У розділі **Build and deployment → Source** обери **GitHub Actions**.
3. Закомить будь-яку зміну в `main` (або запусти workflow вручну: **Actions → Deploy to GitHub Pages → Run workflow**). Після успіху сайт буде доступний за адресою `https://<user>.github.io/<repo>/` — точний URL покаже сам workflow в логу кроку *Deploy to GitHub Pages*.

**Як це працює:**

- Workflow тригериться на `push` у `main` і вручну (`workflow_dispatch`).
- Артефакт — увесь корінь репо як статичний сайт (нема build-кроку).
- `.nojekyll` забороняє GitHub'у запускати Jekyll, який міг би сховати файли, що починаються з `_`, або зламати кеш.
- Усі шляхи в `index.html` та `app.js` (`style.css`, `app.js`, `software.json`, `assets/icons/favicon.svg`) — відносні, тож сайт коректно працює і на user/organization page (`https://<user>.github.io/`), і на project page (`https://<user>.github.io/<repo>/`).

**Кастомний домен:**

Якщо хочеш свій домен, додай файл `CNAME` у корінь репо з єдиним рядком — твоїм доменом (наприклад `software.example.com`) — і налаштуй відповідний DNS-запис (CNAME → `<user>.github.io`).

## Розгортання через Nginx

Скопіюйте всі файли в каталог сервера (наприклад, `/var/www/software-hub`) і додайте `server`-блок:

```nginx
server {
    listen 80;
    server_name software-hub.example.com;

    root /var/www/software-hub;
    index index.html;

    # Один із небагатьох обов'язкових MIME — переконайтеся, що JSON віддається коректно.
    types {
        application/json json;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Не кешуємо software.json, щоб оновлення каталогу одразу підхоплювалося.
    location = /software.json {
        add_header Cache-Control "no-store";
    }

    # Базові заголовки безпеки.
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "no-referrer-when-downgrade";
}
```

Перезавантажте Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Для HTTPS використайте [Certbot](https://certbot.eff.org/) або власні сертифікати.

## Безпека та принципи

- Жодного завантаження файлів на сайт — лише посилання на офіційні джерела.
- Жодного логіна / адмінки / бекенду.
- Жодних сторонніх CDN.
- Дані з `software.json` вставляються в DOM через `textContent` / `setAttribute` — без `innerHTML` для контенту.
- Дозволені тільки `http(s)`-посилання; інші схеми відсікаються у `safeUrl()`.
- Усі зовнішні посилання — `target="_blank"` + `rel="noopener noreferrer"`.

## Ліцензія

Особистий проєкт — використовуйте на власний розсуд.
