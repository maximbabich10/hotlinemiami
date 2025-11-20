/**
 * Тестовый скрипт для проверки CianMailer
 * Запуск: node test-cian.js
 */

require('dotenv').config();
const CianMailer = require('./cian-mailer');

async function test() {
    console.log('🧪 ТЕСТОВЫЙ ЗАПУСК CIAN MAILER\n');
    
    // Проверка переменных окружения
    if (!process.env.CIAN_EMAIL || !process.env.CIAN_PASSWORD) {
        console.error('❌ ОШИБКА: Не указаны CIAN_EMAIL или CIAN_PASSWORD в .env файле');
        console.log('\n📝 Создайте файл .env на основе env.example:');
        console.log('   cp env.example .env');
        console.log('   # Затем отредактируйте .env и укажите свои данные\n');
        process.exit(1);
    }
    
    console.log('✅ Конфигурация загружена');
    console.log(`📧 Email: ${process.env.CIAN_EMAIL}`);
    console.log(`📄 Макс. страниц: ${process.env.MAX_PAGES || '5'}`);
    console.log(`📨 Макс. объявлений/страницу: ${process.env.MAX_PER_PAGE || '10'}`);
    console.log(`⏱️  Пауза: ${process.env.MIN_PAUSE || '15'}-${process.env.MAX_PAUSE || '25'} сек\n`);
    
    const mailer = new CianMailer({
        email: process.env.CIAN_EMAIL,
        password: process.env.CIAN_PASSWORD,
        maxPages: parseInt(process.env.MAX_PAGES || '2'),  // Для теста - только 2 страницы
        maxPerPage: parseInt(process.env.MAX_PER_PAGE || '5'),  // Для теста - только 5 объявлений
        minPause: parseInt(process.env.MIN_PAUSE || '15'),
        maxPause: parseInt(process.env.MAX_PAUSE || '25')
    });
    
    console.log('🚀 Запускаю тестовую рассылку...\n');
    console.log('⚠️  Для теста установлено:');
    console.log('   - Макс. страниц: 2');
    console.log('   - Макс. объявлений/страницу: 5');
    console.log('\n🛑 Нажмите Ctrl+C для остановки\n');
    
    const result = await mailer.run();
    
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

