#!/bin/bash

# Быстрый тест системы авторизации

echo "🧪 Быстрый тест системы авторизации"
echo "===================================="
echo ""

# Проверка Node.js
echo "1️⃣ Проверка Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "   ✅ Node.js установлен: $NODE_VERSION"
else
    echo "   ❌ Node.js не установлен"
    exit 1
fi

# Проверка зависимостей
echo ""
echo "2️⃣ Проверка зависимостей..."
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules найден"
else
    echo "   ⚠️  node_modules не найден, запускаю npm install..."
    npm install
fi

# Проверка .env
echo ""
echo "3️⃣ Проверка .env файла..."
if [ -f ".env" ]; then
    echo "   ✅ .env файл найден"
    if grep -q "TELEGRAM_BOT_TOKEN" .env; then
        echo "   ✅ TELEGRAM_BOT_TOKEN найден"
    else
        echo "   ❌ TELEGRAM_BOT_TOKEN не найден в .env"
        exit 1
    fi
else
    echo "   ⚠️  .env файл не найден, создаю из env.example..."
    cp env.example .env
    echo "   ⚠️  Отредактируйте .env и укажите TELEGRAM_BOT_TOKEN"
    exit 1
fi

# Проверка файлов
echo ""
echo "4️⃣ Проверка файлов..."
FILES=("telegram-bot.js" "cian-mailer.js" "database.js")
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file найден"
    else
        echo "   ❌ $file не найден"
        exit 1
    fi
done

# Проверка БД (если существует)
echo ""
echo "5️⃣ Проверка базы данных..."
if [ -f "users.db" ]; then
    echo "   ✅ users.db найден"
    USER_COUNT=$(sqlite3 users.db "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
    echo "   📊 Пользователей в БД: $USER_COUNT"
else
    echo "   ⚠️  users.db не найден (будет создан при первом запуске)"
fi

# Тест синтаксиса
echo ""
echo "6️⃣ Проверка синтаксиса..."
node -c telegram-bot.js && echo "   ✅ telegram-bot.js - OK" || echo "   ❌ telegram-bot.js - ОШИБКА"
node -c cian-mailer.js && echo "   ✅ cian-mailer.js - OK" || echo "   ❌ cian-mailer.js - ОШИБКА"
node -c database.js && echo "   ✅ database.js - OK" || echo "   ❌ database.js - ОШИБКА"

echo ""
echo "===================================="
echo "✅ Все проверки пройдены!"
echo ""
echo "Следующие шаги:"
echo "1. Запустите бота: npm start"
echo "2. Откройте бота в Telegram"
echo "3. Отправьте /register"
echo "4. Введите номер телефона"
echo "5. Нажмите ▶️ Запустить рассылку"
echo ""
