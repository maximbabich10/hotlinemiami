/**
 * Тестовый скрипт для проверки CianMailer
 * Запуск: node test-cian.js
 */

require('dotenv').config();
const CianMailer = require('./cian-mailer');

async function test() {
    console.log('🧪 ТЕСТОВЫЙ ЗАПУСК CIAN MAILER\n');
    
    // Проверка переменных окружения
    if (!process.env.CIAN_PHONE) {
        console.error('❌ ОШИБКА: Не указан CIAN_PHONE в .env файле');
        console.log('\n📝 Создайте файл .env на основе env.example:');
        console.log('   cp env.example .env');
        console.log('   # Затем отредактируйте .env и укажите номер телефона\n');
        console.log('   Формат: CIAN_PHONE=9771234567 (10 цифр без +7 или 8)\n');
        process.exit(1);
    }
    
    console.log('✅ Конфигурация загружена');
    const phone = process.env.CIAN_PHONE || '';
    const maskedPhone = `+7 (${phone.substring(0, 3)}) ***-**-${phone.substring(8, 10)}`;
    console.log(`📱 Телефон: ${maskedPhone}`);
    console.log(`📄 Макс. страниц: ${process.env.MAX_PAGES || '5'}`);
    console.log(`📨 Макс. объявлений/страницу: ${process.env.MAX_PER_PAGE || '10'}`);
    console.log(`⏱️  Пауза: ${process.env.MIN_PAUSE || '15'}-${process.env.MAX_PAUSE || '25'} сек\n`);
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    // Создаем промис для получения кода от пользователя
    const getCodeFromConsole = () => {
        return new Promise((resolve) => {
            rl.question('📱 Введите код из SMS: ', (code) => {
                resolve(code.trim());
            });
        });
    };
    
    const mailer = new CianMailer({
        phone: process.env.CIAN_PHONE,
        maxPages: parseInt(process.env.MAX_PAGES || '2'),  // Для теста - только 2 страницы
        maxPerPage: parseInt(process.env.MAX_PER_PAGE || '5'),  // Для теста - только 5 объявлений
        minPause: parseInt(process.env.MIN_PAUSE || '15'),
        maxPause: parseInt(process.env.MAX_PAUSE || '25'),
        // Callback для получения кода (в консоли)
        onCodeRequest: getCodeFromConsole
    });
    
    console.log('🚀 Запускаю тестовую рассылку...\n');
    console.log('⚠️  Для теста установлено:');
    console.log('   - Макс. страниц: 2');
    console.log('   - Макс. объявлений/страницу: 5');
    console.log('\n🛑 Нажмите Ctrl+C для остановки\n');
    
    const result = await mailer.run();
    
    rl.close(); // Закрываем readline
    
    if (result.success) {
        console.log('\n✅ ТЕСТ ЗАВЕРШЕН УСПЕШНО!');
        console.log(`📊 Обработано объявлений: ${result.processed}`);
    } else {
        console.log('\n❌ ТЕСТ ЗАВЕРШЕН С ОШИБКОЙ');
        console.log(`⚠️  Ошибка: ${result.error}`);
    }
}

// Обработка Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n⏹️  Тест остановлен пользователем');
    process.exit(0);
});

// Запуск
test().catch(error => {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error);
    process.exit(1);
});

