/**
 * Telegram Bot для управления CIAN Mailer
 * Запускает рассылку по кнопке в Telegram
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const CianMailer = require('./cian-mailer');

// Проверка обязательных переменных окружения
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ ОШИБКА: Не указан TELEGRAM_BOT_TOKEN в .env файле');
    process.exit(1);
}

if (!process.env.CIAN_PHONE) {
    console.error('❌ ОШИБКА: Не указан CIAN_PHONE в .env файле');
    console.error('   Формат: CIAN_PHONE=9771234567 (10 цифр без +7 или 8)');
    process.exit(1);
}

// Создаем бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const adminId = process.env.TELEGRAM_ADMIN_ID ? parseInt(process.env.TELEGRAM_ADMIN_ID) : null;

// Состояние бота
let isRunning = false;
let currentMailer = null;

// Клавиатура с кнопками
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '▶️ Запустить рассылку' }],
            [{ text: '⏹️ Остановить рассылку' }],
            [{ text: '📊 Статистика' }, { text: '⚙️ Настройки' }],
            [{ text: 'ℹ️ Помощь' }]
        ],
        resize_keyboard: true
    }
};

// Функция проверки прав администратора
function isAdmin(userId) {
    if (!adminId) return true; // Если не задан adminId, разрешаем всем
    
    // Список разрешенных пользователей (добавь сюда ID друзей)
    const allowedUsers = [
        adminId,  // Твой ID из .env (792737507)
        // 123456789,  // ID друга (раскомментируй и замени на реальный ID)
        // 987654321,  // ID еще одного друга
    ];
    
    return allowedUsers.includes(userId);
}

// Логирование действий
function log(message, userId = null) {
    const timestamp = new Date().toLocaleString('ru-RU');
    const userInfo = userId ? ` [User: ${userId}]` : '';
    console.log(`[${timestamp}]${userInfo} ${message}`);
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    log('Команда /start', userId);
    
    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав для использования этого бота.');
        return;
    }
    
    const welcomeMessage = `
🤖 **CIAN Telegram Bot**

Добро пожаловать! Этот бот автоматизирует рассылку сообщений на CIAN.

**Доступные команды:**
▶️ Запустить рассылку - Начать автоматическую рассылку
⏹️ Остановить рассылку - Остановить текущую рассылку
📊 Статистика - Посмотреть статистику работы
⚙️ Настройки - Текущие настройки бота
ℹ️ Помощь - Показать справку

Нажмите на любую кнопку для начала работы.
`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...mainKeyboard });
});

// Обработка текстовых сообщений (кнопок)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    // Пропускаем команды (они обрабатываются отдельно)
    if (text.startsWith('/')) return;
    
    log(`Получено сообщение: "${text}"`, userId);
    
    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав для использования этого бота.');
        return;
    }
    
    // Кнопка "Запустить рассылку"
    if (text === '▶️ Запустить рассылку') {
        if (isRunning) {
            bot.sendMessage(chatId, '⚠️ Рассылка уже запущена!', mainKeyboard);
            return;
        }
        
        bot.sendMessage(chatId, '🚀 **Запускаю рассылку...**\n\nЭто может занять несколько минут. Я буду присылать обновления о прогрессе.', { parse_mode: 'Markdown', ...mainKeyboard });
        
        isRunning = true;
        
        try {
            // Создаем Promise для получения кода от пользователя
            let codeResolver = null;
            const codePromise = new Promise((resolve) => {
                codeResolver = resolve;
            });
            
            // Создаем экземпляр CianMailer
            currentMailer = new CianMailer({
                phone: process.env.CIAN_PHONE,
                maxPages: parseInt(process.env.MAX_PAGES || '5'),
                maxPerPage: parseInt(process.env.MAX_PER_PAGE || '10'),
                minPause: parseInt(process.env.MIN_PAUSE || '15'),
                maxPause: parseInt(process.env.MAX_PAUSE || '25'),
                // Callback для запроса кода авторизации
                onCodeRequest: async () => {
                    bot.sendMessage(chatId, '📲 **КОД ПОДТВЕРЖДЕНИЯ**\n\nНа ваш номер отправлен код. Пожалуйста, введите код из SMS:', { parse_mode: 'Markdown' });
                    
                    // Ждем когда пользователь введет код
                    const code = await codePromise;
                    return code;
                }
            });
            
            // Обработчик для получения кода от пользователя (временный)
            const codeHandler = (msg) => {
                if (msg.chat.id === chatId && userId === msg.from.id) {
                    const text = msg.text;
                    // Проверяем что это похоже на код (4-6 цифр)
                    if (/^\d{4,6}$/.test(text)) {
                        bot.sendMessage(chatId, `✅ Код получен: ${text}\n\nПродолжаю авторизацию...`);
                        codeResolver(text);
                        bot.removeListener('message', codeHandler); // Удаляем обработчик
                    }
                }
            };
            
            // Добавляем временный обработчик для получения кода
            bot.on('message', codeHandler);
            
            // Переопределяем метод log для отправки сообщений в Telegram
            const originalLog = currentMailer.log.bind(currentMailer);
            let messageBuffer = '';
            let lastMessageTime = Date.now();
            
            currentMailer.log = (message, type) => {
                originalLog(message, type);
                
                // Отправляем важные сообщения сразу
                const importantKeywords = ['ОШИБКА', 'УСПЕХ', 'ЗАВЕРШЕН', 'АВТОРИЗАЦИЯ', 'СТРАНИЦА'];
                const isImportant = importantKeywords.some(keyword => message.toUpperCase().includes(keyword));
                
                if (isImportant) {
                    const emoji = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
                    bot.sendMessage(chatId, `${emoji} ${message}`, mainKeyboard);
                } else {
                    // Буферизируем обычные сообщения
                    messageBuffer += message + '\n';
                    
                    // Отправляем буфер каждые 10 секунд или если он превысил 500 символов
                    const now = Date.now();
                    if (messageBuffer.length > 500 || (now - lastMessageTime > 10000 && messageBuffer.length > 0)) {
                        bot.sendMessage(chatId, messageBuffer.substring(0, 4000), mainKeyboard).catch(() => {});
                        messageBuffer = '';
                        lastMessageTime = now;
                    }
                }
            };
            
            // Запускаем рассылку
            const result = await currentMailer.run();
            
            // Отправляем финальный отчет
            if (result.success) {
                bot.sendMessage(chatId, `✅ **РАССЫЛКА ЗАВЕРШЕНА!**\n\n📊 Обработано объявлений: ${result.processed}`, { parse_mode: 'Markdown', ...mainKeyboard });
            } else {
                bot.sendMessage(chatId, `❌ **РАССЫЛКА ЗАВЕРШЕНА С ОШИБКОЙ**\n\n⚠️ ${result.error}`, { parse_mode: 'Markdown', ...mainKeyboard });
            }
        } catch (error) {
            log(`Ошибка рассылки: ${error.message}`, userId);
            bot.sendMessage(chatId, `❌ **КРИТИЧЕСКАЯ ОШИБКА**\n\n${error.message}`, { parse_mode: 'Markdown', ...mainKeyboard });
        } finally {
            isRunning = false;
            currentMailer = null;
        }
    }
    
    // Кнопка "Остановить рассылку"
    else if (text === '⏹️ Остановить рассылку') {
        if (!isRunning) {
            bot.sendMessage(chatId, '⚠️ Рассылка не запущена.', mainKeyboard);
            return;
        }
        
        bot.sendMessage(chatId, '⏹️ Останавливаю рассылку...\n\n⚠️ Это может занять некоторое время.', mainKeyboard);
        
        try {
            if (currentMailer && currentMailer.browser) {
                await currentMailer.browser.close();
            }
        } catch (error) {
            // Игнорируем ошибки при закрытии
        }
        
        isRunning = false;
        currentMailer = null;
        
        bot.sendMessage(chatId, '✅ Рассылка остановлена.', mainKeyboard);
    }
    
    // Кнопка "Статистика"
    else if (text === '📊 Статистика') {
        try {
            const fs = require('fs');
            const processedFile = 'processed_ads.txt';
            
            let totalProcessed = 0;
            if (fs.existsSync(processedFile)) {
                const data = fs.readFileSync(processedFile, 'utf-8');
                totalProcessed = data.split('\n').filter(line => line.trim()).length;
            }
            
            const statsMessage = `
📊 **СТАТИСТИКА**

🎯 Всего обработано объявлений: **${totalProcessed}**
${isRunning ? '🟢 Статус: **Рассылка активна**' : '🔴 Статус: **Рассылка остановлена**'}

📁 Файл прогресса: \`${processedFile}\`
`;
            
            bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown', ...mainKeyboard });
        } catch (error) {
            bot.sendMessage(chatId, '❌ Ошибка получения статистики.', mainKeyboard);
        }
    }
    
    // Кнопка "Настройки"
    else if (text === '⚙️ Настройки') {
        const phone = process.env.CIAN_PHONE || '';
        const maskedPhone = phone ? `+7 (${phone.substring(0, 3)}) ***-**-${phone.substring(8, 10)}` : 'не указан';
        
        const settingsMessage = `
⚙️ **ТЕКУЩИЕ НАСТРОЙКИ**

📱 Телефон: \`${maskedPhone}\`
📄 Макс. страниц: **${process.env.MAX_PAGES || '5'}**
📨 Макс. объявлений/страницу: **${process.env.MAX_PER_PAGE || '10'}**
⏱️ Пауза между объявлениями: **${process.env.MIN_PAUSE || '15'}-${process.env.MAX_PAUSE || '25'} сек**

💡 Для изменения настроек отредактируйте файл \`.env\`
`;
        
        bot.sendMessage(chatId, settingsMessage, { parse_mode: 'Markdown', ...mainKeyboard });
    }
    
    // Кнопка "Помощь"
    else if (text === 'ℹ️ Помощь') {
        const helpMessage = `
ℹ️ **СПРАВКА**

**Что делает бот:**
1. Авторизуется в вашем аккаунте CIAN
2. Применяет фильтры (Собственники + Без долей)
3. Находит объявления с кнопкой "Написать"
4. Открывает чат и вводит текст сообщения
5. Сохраняет ID обработанных объявлений (без дублей)

**Защита от капчи:**
- Медленная скорость (~140 сообщ/час)
- Случайные паузы между действиями
- Антидетект браузер (Puppeteer Stealth)
- 4 варианта текста (случайный выбор)

**Важно:**
⚠️ Бот НЕ отправляет сообщения автоматически - только вводит текст
⚠️ Можно останавливать и запускать снова - продолжит с места остановки
⚠️ Все данные сохраняются в \`processed_ads.txt\`

**Файлы проекта:**
• \`telegram-bot.js\` - Telegram бот
• \`cian-mailer.js\` - Автоматизация CIAN
• \`.env\` - Настройки (email, пароль, токен)
• \`processed_ads.txt\` - База обработанных объявлений

**Поддержка:**
Если возникли проблемы, проверьте:
1. Правильность email/пароля в \`.env\`
2. Токен бота от @BotFather
3. Установлены ли все зависимости (\`npm install\`)
`;
        
        bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown', ...mainKeyboard });
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    log(`Polling error: ${error.message}`);
});

// Запуск бота
console.log('🤖 Telegram бот запущен...');
const phone = process.env.CIAN_PHONE || '';
const maskedPhone = phone ? `+7 (${phone.substring(0, 3)}) ***-**-${phone.substring(8, 10)}` : 'не указан';
console.log(`📱 CIAN Телефон: ${maskedPhone}`);
console.log(`🔑 Admin ID: ${adminId || 'Не задан (разрешено всем)'}`);
console.log('✅ Ожидаю команды...\n');

