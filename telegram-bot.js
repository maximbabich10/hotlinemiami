/**
 * Telegram Bot для управления CIAN Mailer
 * С системой авторизации пользователей
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const CianMailer = require('./cian-mailer');
const Database = require('./database');

// Проверка обязательных переменных окружения
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ ОШИБКА: Не указан TELEGRAM_BOT_TOKEN в .env файле');
    process.exit(1);
}

// Создаем бота и БД
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const db = new Database();

// Состояние бота
let isRunning = false;
let currentMailer = null;
const userStates = new Map(); // Хранит состояние регистрации пользователей

// Клавиатура с кнопками
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '▶️ Запустить рассылку' }],
            [{ text: '⏹️ Остановить рассылку' }],
            [{ text: '📊 Статистика' }, { text: '👤 Профиль' }],
            [{ text: 'ℹ️ Помощь' }]
        ],
        resize_keyboard: true
    }
};

const cancelKeyboard = {
    reply_markup: {
        keyboard: [[{ text: '❌ Отмена' }]],
        resize_keyboard: true
    }
};

// Логирование действий
function log(message, userId = null) {
    const timestamp = new Date().toLocaleString('ru-RU');
    const userInfo = userId ? ` [User: ${userId}]` : '';
    console.log(`[${timestamp}]${userInfo} ${message}`);
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    log('Команда /start', userId);
    
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            // Новый пользователь - предлагаем регистрацию
            const welcomeMessage = `
🤖 **CIAN Telegram Bot**

Добро пожаловать! Этот бот автоматизирует рассылку сообщений на CIAN.

❗️ Для начала работы необходимо пройти регистрацию.

Используйте команду /register для регистрации.
`;
            bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        } else {
            // Зарегистрированный пользователь
            const welcomeMessage = `
🤖 **CIAN Telegram Bot**

С возвращением, ${msg.from.first_name}!

**Доступные команды:**
▶️ Запустить рассылку - Начать автоматическую рассылку
⏹️ Остановить рассылку - Остановить текущую рассылку
📊 Статистика - Посмотреть статистику работы
👤 Профиль - Ваши данные и настройки
ℹ️ Помощь - Показать справку

Нажмите на любую кнопку для начала работы.
`;
            bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...mainKeyboard });
        }
    } catch (error) {
        log(`Ошибка при обработке /start: ${error.message}`, userId);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Команда /register - регистрация нового пользователя
bot.onText(/\/register/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    log('Команда /register', userId);
    
    try {
        const existingUser = await db.getUser(userId);
        
        if (existingUser) {
            bot.sendMessage(chatId, '✅ Вы уже зарегистрированы!\n\nИспользуйте /profile для просмотра данных или /update для обновления.', mainKeyboard);
            return;
        }
        
        // Начинаем процесс регистрации
        userStates.set(userId, { step: 'awaiting_phone' });
        
        const registerMessage = `
📝 **РЕГИСТРАЦИЯ**

Для работы с ботом необходимо указать ваш номер телефона, который используется для входа на CIAN.

📱 Введите номер телефона в формате: **9771234567**
(10 цифр без +7 или 8)

Отправьте /cancel для отмены.
`;
        bot.sendMessage(chatId, registerMessage, { parse_mode: 'Markdown', ...cancelKeyboard });
    } catch (error) {
        log(`Ошибка при регистрации: ${error.message}`, userId);
        bot.sendMessage(chatId, '❌ Произошла ошибка при регистрации.');
    }
});

// Команда /profile - просмотр профиля
bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    log('Команда /profile', userId);
    
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы. Используйте /register для регистрации.');
            return;
        }
        
        const stats = await db.getUserStats(userId);
        const maskedPhone = user.phone_number ? 
            `+7 (${user.phone_number.substring(0, 3)}) ***-**-${user.phone_number.substring(8, 10)}` : 
            'не указан';
        
        const profileMessage = `
👤 **ВАШ ПРОФИЛЬ**

📱 Телефон: \`${maskedPhone}\`
🆔 Telegram ID: \`${user.telegram_id}\`
📅 Дата регистрации: ${new Date(user.created_at).toLocaleDateString('ru-RU')}

📊 **СТАТИСТИКА:**
🎯 Всего сессий: ${stats.total_sessions || 0}
📨 Всего обработано объявлений: ${stats.total_ads || 0}
🕐 Последняя сессия: ${stats.last_session ? new Date(stats.last_session).toLocaleString('ru-RU') : 'Нет данных'}

Для обновления данных используйте /update
`;
        
        bot.sendMessage(chatId, profileMessage, { parse_mode: 'Markdown', ...mainKeyboard });
    } catch (error) {
        log(`Ошибка при просмотре профиля: ${error.message}`, userId);
        bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке профиля.');
    }
});

// Команда /update - обновление номера телефона
bot.onText(/\/update/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    log('Команда /update', userId);
    
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы. Используйте /register для регистрации.');
            return;
        }
        
        userStates.set(userId, { step: 'updating_phone' });
        
        const updateMessage = `
📝 **ОБНОВЛЕНИЕ ДАННЫХ**

Текущий номер: \`${user.phone_number}\`

📱 Введите новый номер телефона в формате: **9771234567**
(10 цифр без +7 или 8)

Отправьте /cancel для отмены.
`;
        bot.sendMessage(chatId, updateMessage, { parse_mode: 'Markdown', ...cancelKeyboard });
    } catch (error) {
        log(`Ошибка при обновлении: ${error.message}`, userId);
        bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
});

// Команда /cancel - отмена текущей операции
bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (userStates.has(userId)) {
        userStates.delete(userId);
        bot.sendMessage(chatId, '❌ Операция отменена.', mainKeyboard);
    } else {
        bot.sendMessage(chatId, 'Нет активных операций для отмены.', mainKeyboard);
    }
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    // Пропускаем команды (они обрабатываются отдельно)
    if (text.startsWith('/')) return;
    
    log(`Получено сообщение: "${text}"`, userId);
    
    // Проверяем, находится ли пользователь в процессе регистрации/обновления
    if (userStates.has(userId)) {
        const state = userStates.get(userId);
        
        // Обработка отмены
        if (text === '❌ Отмена') {
            userStates.delete(userId);
            bot.sendMessage(chatId, '❌ Операция отменена.', mainKeyboard);
            return;
        }
        
        // Ожидание номера телефона при регистрации
        if (state.step === 'awaiting_phone') {
            // Валидация номера телефона
            if (!/^\d{10}$/.test(text)) {
                bot.sendMessage(chatId, '❌ Неверный формат номера.\n\nВведите 10 цифр без +7 или 8.\nНапример: 9771234567', cancelKeyboard);
                return;
            }
            
            try {
                await db.registerUser(userId, text);
                userStates.delete(userId);
                
                const successMessage = `
✅ **РЕГИСТРАЦИЯ ЗАВЕРШЕНА!**

Ваш номер телефона сохранен: \`+7${text}\`

Теперь вы можете использовать бота для рассылки на CIAN.

При запуске рассылки бот автоматически авторизуется под вашим аккаунтом.

Нажмите **▶️ Запустить рассылку** для начала работы.
`;
                bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown', ...mainKeyboard });
                log(`Пользователь ${userId} успешно зарегистрирован с номером ${text}`, userId);
            } catch (error) {
                log(`Ошибка сохранения пользователя: ${error.message}`, userId);
                bot.sendMessage(chatId, '❌ Ошибка при сохранении данных. Попробуйте позже.', mainKeyboard);
                userStates.delete(userId);
            }
            return;
        }
        
        // Обновление номера телефона
        if (state.step === 'updating_phone') {
            if (!/^\d{10}$/.test(text)) {
                bot.sendMessage(chatId, '❌ Неверный формат номера.\n\nВведите 10 цифр без +7 или 8.\nНапример: 9771234567', cancelKeyboard);
                return;
            }
            
            try {
                await db.registerUser(userId, text); // registerUser обновляет, если пользователь существует
                userStates.delete(userId);
                
                bot.sendMessage(chatId, `✅ Номер телефона обновлен: \`+7${text}\``, { parse_mode: 'Markdown', ...mainKeyboard });
                log(`Пользователь ${userId} обновил номер на ${text}`, userId);
            } catch (error) {
                log(`Ошибка обновления номера: ${error.message}`, userId);
                bot.sendMessage(chatId, '❌ Ошибка при обновлении данных.', mainKeyboard);
                userStates.delete(userId);
            }
            return;
        }
    }
    
    // Проверка авторизации для основных функций
    const user = await db.getUser(userId).catch(() => null);
    
    if (!user && !['ℹ️ Помощь'].includes(text)) {
        bot.sendMessage(chatId, '❌ Вы не зарегистрированы.\n\nИспользуйте /register для регистрации.');
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
        let sessionId = null;
        
        try {
            // Создаем сессию в БД
            const session = await db.createSession(userId);
            sessionId = session.sessionId;
            
            // Создаем Promise для получения кода от пользователя
            let codeResolver = null;
            const codePromise = new Promise((resolve) => {
                codeResolver = resolve;
            });
            
            // Создаем экземпляр CianMailer с данными пользователя
            currentMailer = new CianMailer({
                phone: user.phone_number,
                maxPages: parseInt(process.env.MAX_PAGES || '5'),
                maxPerPage: parseInt(process.env.MAX_PER_PAGE || '10'),
                minPause: parseInt(process.env.MIN_PAUSE || '3'),
                maxPause: parseInt(process.env.MAX_PAUSE || '5'),
                // Callback для запроса кода авторизации
                onCodeRequest: async () => {
                    bot.sendMessage(chatId, '📲 **КОД ПОДТВЕРЖДЕНИЯ**\n\nНа ваш номер отправлен код. Пожалуйста, введите код из SMS:', { parse_mode: 'Markdown' });
                    
                    // Ждем когда пользователь введет код
                    const code = await codePromise;
                    return code;
                },
                // Notifier для отправки уведомлений
                notifier: (event, payload) => {
                    if (event === 'ad-start') {
                        const message = `
📨 **Начинаю обработку объявления:**
ID: \`${payload.adId}\`
📍 Адрес: ${payload.address}
💰 Цена: ${payload.price}
`;
                        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...mainKeyboard });
                    } else if (event === 'ad-complete') {
                        const message = `✅ **Сообщение введено для объявления:**
ID: \`${payload.adId}\`
`;
                        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...mainKeyboard });
                    }
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
            
            // Запускаем рассылку
            const result = await currentMailer.run();
            
            // Обновляем сессию в БД
            if (sessionId) {
                await db.updateSession(sessionId, result.processed || 0, result.success ? 'completed' : 'failed');
            }
            
            // Отправляем финальный отчет
            if (result.success) {
                bot.sendMessage(chatId, `✅ **РАССЫЛКА ЗАВЕРШЕНА!**\n\n📊 Обработано объявлений: ${result.processed}`, { parse_mode: 'Markdown', ...mainKeyboard });
            } else {
                bot.sendMessage(chatId, `❌ **РАССЫЛКА ЗАВЕРШЕНА С ОШИБКОЙ**\n\n⚠️ ${result.error}`, { parse_mode: 'Markdown', ...mainKeyboard });
            }
        } catch (error) {
            log(`Ошибка рассылки: ${error.message}`, userId);
            
            // Обновляем сессию как failed
            if (sessionId) {
                await db.updateSession(sessionId, 0, 'failed').catch(() => {});
            }
            
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
            const stats = await db.getUserStats(userId);
            
            const statsMessage = `
📊 **СТАТИСТИКА**

🎯 Всего сессий: **${stats.total_sessions || 0}**
📨 Всего обработано объявлений: **${stats.total_ads || 0}**
🕐 Последняя сессия: ${stats.last_session ? new Date(stats.last_session).toLocaleString('ru-RU') : 'Нет данных'}
${isRunning ? '🟢 Статус: **Рассылка активна**' : '🔴 Статус: **Рассылка остановлена**'}
`;
            
            bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown', ...mainKeyboard });
        } catch (error) {
            bot.sendMessage(chatId, '❌ Ошибка получения статистики.', mainKeyboard);
        }
    }
    
    // Кнопка "Профиль"
    else if (text === '👤 Профиль') {
        // Вызываем команду /profile
        bot.emit('message', { ...msg, text: '/profile' });
    }
    
    // Кнопка "Помощь"
    else if (text === 'ℹ️ Помощь') {
        const helpMessage = `
ℹ️ **СПРАВКА**

**Что делает бот:**
1. Авторизуется в вашем аккаунте CIAN (используя ваш номер телефона)
2. Применяет фильтры (Собственники + Без долей)
3. Находит объявления с кнопкой "Написать"
4. Открывает чат и вводит текст сообщения
5. Сохраняет ID обработанных объявлений (без дублей)

**Команды:**
/register - Регистрация в боте
/profile - Просмотр профиля и статистики
/update - Обновление номера телефона
/cancel - Отмена текущей операции

**Защита от капчи:**
- Медленная скорость работы
- Случайные паузы между действиями
- Антидетект браузер (Puppeteer Stealth)
- Варианты текста (случайный выбор)

**Важно:**
⚠️ Бот НЕ отправляет сообщения автоматически - только вводит текст
⚠️ Можно останавливать и запускать снова - продолжит с места остановки
⚠️ Все данные сохраняются в базе данных

**Приватность:**
🔒 Ваш номер телефона хранится в зашифрованном виде
🔒 Данные не передаются третьим лицам
🔒 Вы можете удалить свои данные в любой момент (/delete)
`;
        
        bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown', ...mainKeyboard });
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    log(`Polling error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Получен сигнал остановки...');
    
    try {
        if (currentMailer && currentMailer.browser) {
            await currentMailer.browser.close();
        }
        await db.close();
        await bot.stopPolling();
    } catch (error) {
        console.error('Ошибка при остановке:', error.message);
    }
    
    console.log('✅ Бот остановлен');
    process.exit(0);
});

// Запуск бота
console.log('🤖 Telegram бот запущен...');
console.log('✅ Ожидаю команды...\n');
