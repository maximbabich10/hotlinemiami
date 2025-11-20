# 📦 Инструкция по установке

## Шаг 1: Установка Node.js

### macOS
```bash
# Через Homebrew
brew install node

# Или скачайте с официального сайта
# https://nodejs.org/ (версия 18 LTS или выше)
```

### Windows
1. Скачайте установщик с [nodejs.org](https://nodejs.org/)
2. Запустите установщик
3. Убедитесь, что выбрана опция "Add to PATH"

### Linux (Ubuntu/Debian)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Проверьте установку:
```bash
node --version  # Должно показать v18.x.x или выше
npm --version   # Должно показать 9.x.x или выше
```

## Шаг 2: Клонирование проекта

```bash
# Если проект уже есть локально - переходите в папку
cd hotlinemiami

# Или клонируйте из Git
git clone <your-repo-url>
cd hotlinemiami
```

## Шаг 3: Установка зависимостей

```bash
npm install
```

Эта команда установит:
- `puppeteer` - для автоматизации браузера
- `node-telegram-bot-api` - для Telegram бота
- `dotenv` - для работы с переменными окружения
- и другие необходимые пакеты

⏳ **Внимание:** Первая установка может занять 2-5 минут, т.к. Puppeteer скачивает Chromium (~170 MB)

## Шаг 4: Создание Telegram бота

### 4.1 Создание бота через BotFather

1. Откройте Telegram
2. Найдите [@BotFather](https://t.me/BotFather)
3. Отправьте команду: `/newbot`
4. Введите имя бота (например: `CIAN Mailer Bot`)
5. Введите username бота (должен заканчиваться на `bot`, например: `cian_mailer_bot`)
6. **Сохраните токен**, который даст BotFather (выглядит как `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 4.2 Получение вашего Telegram ID

1. Найдите в Telegram бота [@userinfobot](https://t.me/userinfobot)
2. Отправьте ему любое сообщение
3. Бот ответит с вашим ID (например: `Your ID: 123456789`)
4. **Сохраните этот ID**

## Шаг 5: Настройка конфигурации

### 5.1 Создание .env файла

```bash
# Скопируйте пример
cp env.example .env

# Или если не работает
cat env.example > .env
```

### 5.2 Заполнение .env файла

Откройте файл `.env` в любом текстовом редакторе:

```bash
# macOS
nano .env
# или
open -e .env

# Windows
notepad .env

# Linux
nano .env
```

Заполните следующие поля:

```env
# 1. Ваш email и пароль от CIAN
CIAN_EMAIL=your_email@mail.ru
CIAN_PASSWORD=your_password

# 2. Токен бота от BotFather (из шага 4.1)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# 3. Ваш Telegram ID (из шага 4.2)
TELEGRAM_ADMIN_ID=123456789

# 4. Настройки рассылки (можно оставить по умолчанию)
MAX_PAGES=5          # Количество страниц для обработки
MAX_PER_PAGE=10      # Объявлений на странице
MIN_PAUSE=15         # Минимальная пауза между объявлениями (секунды)
MAX_PAUSE=25         # Максимальная пауза между объявлениями (секунды)
```

**Сохраните файл** (Ctrl+O, Enter, Ctrl+X в nano)

## Шаг 6: Проверка установки

```bash
# Проверьте что все файлы на месте
ls -la

# Должны быть:
# telegram-bot.js
# cian-mailer.js
# package.json
# .env
```

## Шаг 7: Запуск бота

```bash
npm run dev
# или
npm start
```

Вы должны увидеть:

```
🤖 Telegram бот запущен...
📧 CIAN Email: your_email@mail.ru
🔑 Admin ID: 123456789
✅ Ожидаю команды...
```

## Шаг 8: Первый запуск

1. Откройте Telegram
2. Найдите вашего бота (по username, который вы создали)
3. Отправьте команду: `/start`
4. Должна появиться клавиатура с кнопками:
   - ▶️ Запустить рассылку
   - ⏹️ Остановить рассылку
   - 📊 Статистика
   - ⚙️ Настройки
   - ℹ️ Помощь

5. Нажмите **"▶️ Запустить рассылку"**

🎉 **Готово!** Бот начнет работу.

## 🐛 Решение проблем

### Ошибка: "Cannot find module 'puppeteer'"

```bash
rm -rf node_modules package-lock.json
npm install
```

### Ошибка: "TELEGRAM_BOT_TOKEN is not defined"

- Убедитесь, что файл `.env` существует
- Проверьте, что в `.env` нет опечаток в названиях переменных
- Перезапустите бота

### Ошибка: "У вас нет прав для использования этого бота"

- Убедитесь, что `TELEGRAM_ADMIN_ID` в `.env` совпадает с вашим ID
- Получите свой ID через [@userinfobot](https://t.me/userinfobot)
- Перезапустите бота

### Бот не открывает браузер

```bash
# Установите Chromium вручную
npx puppeteer browsers install chrome
```

### Ошибка авторизации на CIAN

- Проверьте email/пароль в `.env`
- Попробуйте войти вручную на cian.ru
- Убедитесь, что аккаунт не заблокирован

## 📱 Автозапуск при перезагрузке

### macOS/Linux (systemd)

Создайте файл `/etc/systemd/system/cian-bot.service`:

```ini
[Unit]
Description=CIAN Telegram Bot
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/hotlinemiami
ExecStart=/usr/bin/node telegram-bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Запустите:
```bash
sudo systemctl enable cian-bot
sudo systemctl start cian-bot
```

### macOS (launchd)

Создайте файл `~/Library/LaunchAgents/com.cianbot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cianbot</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/hotlinemiami/telegram-bot.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/hotlinemiami</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Запустите:
```bash
launchctl load ~/Library/LaunchAgents/com.cianbot.plist
```

### Windows (Task Scheduler)

1. Откройте Task Scheduler
2. Create Basic Task
3. Trigger: At startup
4. Action: Start a program
5. Program: `node`
6. Arguments: `telegram-bot.js`
7. Start in: `C:\path\to\hotlinemiami`

## 🔄 Обновление

```bash
# Остановите бота (Ctrl+C)
git pull
npm install
npm start
```

## 📞 Поддержка

Если проблема не решена - создайте Issue в репозитории с описанием ошибки.

---

**Удачной установки! 🚀**

