/**
 * CIAN Mailer Bot - Автоматизация браузера для рассылки на CIAN
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const DEFAULT_SEARCH_URL = 'https://www.cian.ru/cat.php?deal_type=sale&engine_version=2&flat_share=2&offer_seller_type%5B0%5D=2&offer_type=flat&region=1';

// Применяем stealth плагин для обхода детектирования автоматизации
puppeteer.use(StealthPlugin());

class CianMailer {
    constructor(config = {}) {
        this.phone = config.phone;
        const maxPagesNumber =
            typeof config.maxPages === 'number' && Number.isFinite(config.maxPages) && config.maxPages > 0
                ? Math.floor(config.maxPages)
                : null;
        this.maxPages = maxPagesNumber ?? Infinity;
        this.maxPerPage = config.maxPerPage || 10; // НЕ ИСПОЛЬЗУЕТСЯ - обрабатываются ВСЕ объявления на странице
        this.minPause = config.minPause || 4;
        this.maxPause = config.maxPause || 10;
        
        this.browser = null;
        this.page = null;
        this.processedFile = 'processed_ads.txt';
        this.processedIds = new Set();
        this.alwaysProcess = !!config.alwaysProcess;
        this.notifier = typeof config.notifier === 'function' ? config.notifier : null;
        this.logFile = 'cian_mailer.log';
        this.errorLogFile = 'error_log.txt';
        
        // Callback для получения кода авторизации от Telegram бота
        this.onCodeRequest = config.onCodeRequest || null;
        
        // Варианты сообщений (передаются из конфига или будут дефолтными)
        this.messageVariants = config.messageVariants || [];

        this.searchUrl = config.searchUrl || process.env.CIAN_SEARCH_URL || DEFAULT_SEARCH_URL;
        this.searchBaseUrl = null;
        this.currentResultsUrl = null;

        this.rektCaptcha = {
            extensionPath: config.rektCaptchaExtensionPath
                ? path.resolve(config.rektCaptchaExtensionPath)
                : null,
            popupPage: config.rektCaptchaPopup || 'popup.html',
            autoConfigure: config.rektCaptchaAutoConfigure !== false,
            autoOpen: config.rektCaptchaAutoOpen !== false,
            autoSolve: config.rektCaptchaAutoSolve !== false,
            clickDelay: typeof config.rektCaptchaClickDelay === 'number'
                ? config.rektCaptchaClickDelay
                : 300,
            solveDelay: typeof config.rektCaptchaSolveDelay === 'number'
                ? config.rektCaptchaSolveDelay
                : 3000,
            profileDir: null, // Будет создан временный профиль при запуске
            extensionId: null,
            storagePage: null,
            storageWarningShown: false
        };
        
        this.tempProfileDir = null; // Храним путь к временному профилю для удаления
    }

    async getWriteButtonFromCard(card) {
        const buttons = await card.$$('button');
        for (const btn of buttons) {
            const text = await btn.evaluate(el => (el.textContent || '').toLowerCase().trim());
            if (
                text.includes('написать') ||
                text.includes('связаться') ||
                text.includes('message') ||
                text.includes('отправить')
            ) {
                return btn;
            }
        }
        return null;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleString('ru-RU');
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
        const logMessage = `[${timestamp}] ${prefix} ${message}`;
        
        // Вывод в консоль
        console.log(logMessage);
        
        // Запись в файл
        try {
            fsSync.appendFileSync(this.logFile, logMessage + '\n', 'utf-8');
        } catch (error) {
            console.error('Ошибка записи в лог-файл:', error.message);
        }
        
        // Если это ошибка - дополнительно записываем в error_log.txt
        if (type === 'error') {
            try {
                const errorMessage = `\n${'='.repeat(60)}\nОшибка: ${timestamp}\n${'='.repeat(60)}\n${message}\n${'='.repeat(60)}\n\n`;
                fsSync.appendFileSync(this.errorLogFile, errorMessage, 'utf-8');
            } catch (error) {
                console.error('Ошибка записи в error_log.txt:', error.message);
            }
        }
    }

    async delay(min, max) {
        const ms = (Math.random() * (max - min) + min) * 1000;
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async loadProcessedIds() {
        if (this.alwaysProcess) {
            this.processedIds = new Set();
            this.log('Режим alwaysProcess включён — список обработанных не используется');
            return;
        }
        try {
            const data = await fs.readFile(this.processedFile, 'utf-8');
            const ids = data
                .split('\n')
                .map(id => id.trim())
                .filter(id => id && !id.startsWith('temp_'));
            this.processedIds = new Set(ids);
            this.log(`Загружено ${this.processedIds.size} обработанных объявлений`);
        } catch (error) {
            this.log('Файл прогресса не найден, создаю новый', 'warning');
            this.processedIds = new Set();
        }
    }

    async saveProcessedId(adId) {
        if (this.alwaysProcess) return;
        if (!adId || adId.startsWith('temp_')) {
            return;
        }
        if (this.processedIds.has(adId)) {
            return;
        }
        await fs.appendFile(this.processedFile, `${adId}\n`);
        this.processedIds.add(adId);
    }

    isProcessed(adId) {
        if (!adId || adId.startsWith('temp_')) {
            return false;
        }
        return this.alwaysProcess ? false : this.processedIds.has(adId);
    }

    notify(event, payload = {}) {
        if (!this.notifier) return;
        try {
            this.notifier(event, payload);
        } catch (error) {
            this.log(`Ошибка в notifier: ${error.message}`, 'warning');
        }
    }

    async initBrowser() {
        try {
            this.log('🚀 Запуск браузера Google Chrome (антидетект режим)...');
            
            // Путь к Google Chrome на macOS
            const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
            let extensionPathToUse = null;

            if (this.rektCaptcha?.extensionPath) {
                const manifestPath = path.join(this.rektCaptcha.extensionPath, 'manifest.json');
                
                if (fsSync.existsSync(this.rektCaptcha.extensionPath) && fsSync.existsSync(manifestPath)) {
                    extensionPathToUse = this.rektCaptcha.extensionPath;
                    this.log(`🧩 Найден manifest.json расширения: ${manifestPath}`);
                    
                    // Создаём ВРЕМЕННЫЙ профиль для чистого запуска (как требуется)
                    const os = require('os');
                    const timestamp = Date.now();
                    const randomSuffix = Math.random().toString(36).substring(2, 8);
                    this.tempProfileDir = path.join(os.tmpdir(), `chrome_profile_rektcaptcha_${timestamp}_${randomSuffix}`);
                    
                    try {
                        fsSync.mkdirSync(this.tempProfileDir, { recursive: true });
                        this.rektCaptcha.profileDir = this.tempProfileDir;
                        this.log(`✅ Создан временный профиль Chrome: ${this.tempProfileDir}`);
                    } catch (profileError) {
                        this.log(`Ошибка создания временного профиля Chrome: ${profileError.message}`, 'warning');
                        this.tempProfileDir = null;
                        this.rektCaptcha.profileDir = null;
                    }
                } else {
                    if (!fsSync.existsSync(this.rektCaptcha.extensionPath)) {
                        this.log(`❌ Путь к расширению rektCaptcha не найден: ${this.rektCaptcha.extensionPath}`, 'warning');
                    } else {
                        this.log(`❌ manifest.json не найден в директории расширения: ${manifestPath}`, 'warning');
                    }
                    this.rektCaptcha.extensionPath = null;
                    this.rektCaptcha.autoConfigure = false;
                }
            }
            
            // Проверяем наличие Chrome
            let browserPath = undefined;
            if (fsSync.existsSync(chromePath)) {
                browserPath = chromePath;
                this.log('✅ Найден Google Chrome, запускаю Chrome');
            } else {
                this.log('⚠️ Google Chrome не найден, использую встроенный Chromium', 'warning');
            }
            
            const launchArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--lang=ru-RU,ru'
            ];

            if (extensionPathToUse) {
                launchArgs.push(`--disable-extensions-except=${extensionPathToUse}`);
                launchArgs.push(`--load-extension=${extensionPathToUse}`);
            }

            const launchOptions = {
                headless: false,
                executablePath: browserPath,
                args: launchArgs,
                defaultViewport: null
            };

            if (extensionPathToUse) {
                launchOptions.userDataDir = this.rektCaptcha.profileDir;
            }

            this.browser = await puppeteer.launch(launchOptions);

            this.page = await this.browser.newPage();
            
            // Скрываем факт автоматизации
            await this.page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
            });

            this.log('Браузер успешно запущен', 'success');

            // КРИТИЧЕСКАЯ ПРОВЕРКА: Расширение загружено?
            if (extensionPathToUse) {
                await this.delay(2, 2); // Даём время расширению загрузиться
                
                const targets = this.browser.targets();
                const extensionTargets = targets.filter(t => t.url().startsWith('chrome-extension://'));
                
                this.log(`🔍 Найдено расширений в браузере: ${extensionTargets.length}`);
                extensionTargets.forEach(t => {
                    this.log(`   • ${t.type()}: ${t.url()}`);
                });
                
                if (extensionTargets.length === 0) {
                    this.log('❌ КРИТИЧЕСКАЯ ОШИБКА: Расширение НЕ ЗАГРУЗИЛОСЬ!', 'error');
                    this.log('💡 Проверьте путь к расширению в .env', 'error');
                }
            }

            if (extensionPathToUse && this.rektCaptcha.autoConfigure) {
                const configured = await this.configureRektCaptchaExtension();
                if (configured) {
                    this.log('✅ Расширение rektCaptcha настроено и готово к работе', 'success');
                } else {
                    this.log('⚠️ Расширение rektCaptcha не настроено, но продолжаем работу', 'warning');
                }
            } else if (extensionPathToUse) {
                this.log('⚠️ Автоконфигурация расширения отключена', 'warning');
            }
            
            return true;
        } catch (error) {
            this.log(`Ошибка запуска браузера: ${error.message}`, 'error');
            return false;
        }
    }

    async getRektCaptchaExtensionId() {
        if (!this.browser || !this.rektCaptcha?.extensionPath) {
            return null;
        }
        if (this.rektCaptcha.extensionId) {
            return this.rektCaptcha.extensionId;
        }

        const extractId = target => {
            if (!target || typeof target.url !== 'function') {
                return null;
            }
            const url = target.url();
            if (!url || !url.startsWith('chrome-extension://')) {
                return null;
            }
            const match = url.match(/chrome-extension:\/\/([^/]+)\//);
            return match ? match[1] : null;
        };

        const currentTargets = this.browser.targets();
        for (const target of currentTargets) {
            if (!['background_page', 'service_worker', 'page'].includes(target.type())) {
                continue;
            }
            const id = extractId(target);
            if (id) {
                this.rektCaptcha.extensionId = id;
                return id;
            }
        }

        try {
            const awaitedTarget = await this.browser.waitForTarget(candidate => {
                if (!['background_page', 'service_worker', 'page'].includes(candidate.type())) {
                    return false;
                }
                return extractId(candidate) !== null;
            }, { timeout: 5000 });
            const awaitedId = extractId(awaitedTarget);
            if (awaitedId) {
                this.rektCaptcha.extensionId = awaitedId;
                return awaitedId;
            }
        } catch (error) {
            // Игнорируем таймаут поиска extensionId
        }

        return null;
    }

    async configureRektCaptchaExtension() {
        if (!this.browser || !this.rektCaptcha?.extensionPath) {
            return false;
        }

        try {
            const extensionId = await this.getRektCaptchaExtensionId();
            if (!extensionId) {
                this.log('❌ Не удалось определить ID расширения rektCaptcha', 'error');
                this.log('💡 Расширение может не загрузиться. Проверьте путь в .env', 'warning');
                return false;
            }
            
            this.log(`✅ ID расширения rektCaptcha: ${extensionId}`, 'success');

            const normalize = pageName => (pageName || '').replace(/^\/+/, '');
            const candidatePages = [
                normalize(this.rektCaptcha.popupPage),
                'popup.html',
                'options.html',
                'index.html'
            ].filter(Boolean);

            const triedPages = new Set();
            let extensionPage = null;
            let openedUrl = null;

            try {
                for (const pageName of candidatePages) {
                    if (triedPages.has(pageName)) {
                        continue;
                    }
                    triedPages.add(pageName);
                    const url = `chrome-extension://${extensionId}/${pageName}`;
                    const page = await this.browser.newPage();
                    try {
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
                        extensionPage = page;
                        openedUrl = url;
                        break;
                    } catch (navigationError) {
                        await page.close().catch(() => {});
                    }
                }

                if (!extensionPage) {
                    this.log('Не удалось открыть страницу настроек rektCaptcha', 'warning');
                    return false;
                }

                this.log(`Настраиваю rektCaptcha через ${openedUrl}`);
                
                // КРИТИЧНО: Сначала устанавливаем настройки через chrome.storage.local
                // Делаем это НЕСКОЛЬКО РАЗ для надёжности
                for (let i = 0; i < 3; i++) {
                    await extensionPage.evaluate(() => {
                        return chrome.storage.local.set({
                            'recaptcha_auto_open': true,
                            'recaptcha_auto_solve': true,
                            'recaptcha_click_delay_time': 300,
                            'recaptcha_solve_delay_time': 3000
                        });
                    });
                    await extensionPage.waitForTimeout(200);
                }
                
                this.log('✅ Настройки записаны в chrome.storage.local (3 раза для надёжности)', 'success');
                await extensionPage.waitForTimeout(1000);
                
                const settingsPayload = {
                    autoOpen: !!this.rektCaptcha.autoOpen,
                    autoSolve: !!this.rektCaptcha.autoSolve,
                    clickDelay: String(this.rektCaptcha.clickDelay ?? ''),
                    solveDelay: String(this.rektCaptcha.solveDelay ?? '')
                };

                const result = await extensionPage.evaluate(settings => {
                    const ensureToggle = (selector, shouldBeOn) => {
                        const el = document.querySelector(selector);
                        if (!el) {
                            return false;
                        }
                        
                        // ПРИНУДИТЕЛЬНО кликаем несколько раз для надёжности
                        const isOn = el.classList.contains('on');
                        if (shouldBeOn && !isOn) {
                            el.click();
                            // Ждём и кликаем ещё раз
                            setTimeout(() => {
                                if (!el.classList.contains('on')) {
                                    el.click();
                                }
                            }, 100);
                        }
                        if (!shouldBeOn && isOn) {
                            el.click();
                        }
                        
                        // Проверяем результат
                        return el.classList.contains(shouldBeOn ? 'on' : 'off');
                    };

                    const ensureInput = (selector, value) => {
                        const input = document.querySelector(selector);
                        if (!input) {
                            return false;
                        }
                        input.focus();
                        input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.value = value;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    };

                    // Получаем информацию о всех доступных настройках для диагностики
                    const allToggles = Array.from(document.querySelectorAll('.settings_toggle, input[data-settings]')).map(el => ({
                        selector: el.getAttribute('data-settings'),
                        type: el.tagName,
                        isOn: el.classList?.contains('on') || el.checked,
                        value: el.value || null
                    }));

                    return {
                        autoOpenApplied: ensureToggle('.settings_toggle[data-settings="recaptcha_auto_open"]', settings.autoOpen),
                        autoSolveApplied: ensureToggle('.settings_toggle[data-settings="recaptcha_auto_solve"]', settings.autoSolve),
                        clickDelayApplied: ensureInput('input[data-settings="recaptcha_click_delay_time"]', settings.clickDelay),
                        solveDelayApplied: ensureInput('input[data-settings="recaptcha_solve_delay_time"]', settings.solveDelay),
                        availableSettings: allToggles
                    };
                }, settingsPayload);

                await extensionPage.waitForTimeout(1000);

                const issues = [];
                if (!result.autoOpenApplied) issues.push('auto-open');
                if (!result.autoSolveApplied) issues.push('auto-solve');
                if (!result.clickDelayApplied) issues.push('click delay');
                if (!result.solveDelayApplied) issues.push('solve delay');

                if (issues.length) {
                    this.log(`Не удалось настроить элементы rektCaptcha: ${issues.join(', ')}`, 'warning');
                } else {
                    this.log('✅ Настройки rektCaptcha обновлены (autoOpen=true, autoSolve=true)', 'success');
                }
                
                // Проверяем, что настройки сохранились в chrome.storage
                const storageCheck = await extensionPage.evaluate(() => {
                    return chrome.storage.local.get([
                        'recaptcha_auto_open',
                        'recaptcha_auto_solve',
                        'recaptcha_click_delay_time',
                        'recaptcha_solve_delay_time'
                    ]);
                });
                
                this.log('📦 Настройки в chrome.storage.local:', 'info');
                this.log(`   • recaptcha_auto_open: ${storageCheck.recaptcha_auto_open}`);
                this.log(`   • recaptcha_auto_solve: ${storageCheck.recaptcha_auto_solve}`);
                this.log(`   • recaptcha_click_delay_time: ${storageCheck.recaptcha_click_delay_time}ms`);
                this.log(`   • recaptcha_solve_delay_time: ${storageCheck.recaptcha_solve_delay_time}ms`);
                
                // Выводим доступные настройки для диагностики
                if (result.availableSettings && result.availableSettings.length > 0) {
                    this.log(`📋 Настройки в UI:`, 'info');
                    result.availableSettings.forEach(s => {
                        const value = s.value ? ` (${s.value}ms)` : '';
                        this.log(`   • ${s.selector}: ${s.isOn ? 'ON' : 'OFF'}${value}`);
                    });
                }
                
                if (!storageCheck.recaptcha_auto_open || !storageCheck.recaptcha_auto_solve) {
                    this.log('❌ КРИТИЧЕСКАЯ ОШИБКА: Auto-Open или Auto-Solve не включены!', 'error');
                    this.log('💡 Расширение НЕ БУДЕТ решать капчу автоматически', 'error');
                } else {
                    this.log('✅ Auto-Open и Auto-Solve включены - расширение готово!', 'success');
                }
                
                this.log('⚠️ ВАЖНО: Эта версия rektCaptcha работает ЛОКАЛЬНО (без облака)', 'warning');
                this.log('💡 Расширение использует ONNX модели для распознавания картинок', 'info');

                // Сохраняем скриншот страницы настроек для диагностики
                try {
                    await extensionPage.screenshot({ path: 'rektcaptcha_settings.png' });
                    this.log('📸 Скриншот настроек сохранён: rektcaptcha_settings.png');
                } catch (screenshotError) {
                    // Игнорируем ошибки скриншота
                }

                // Даём дополнительное время для сохранения настроек
                await extensionPage.waitForTimeout(1000);
                
                // КРИТИЧНО: Перезагружаем страницу настроек чтобы изменения применились
                this.log('🔄 Перезагружаю страницу настроек для применения изменений...', 'info');
                await extensionPage.reload({ waitUntil: 'domcontentloaded' });
                await extensionPage.waitForTimeout(1000);
                
                // Проверяем настройки после перезагрузки
                const finalCheck = await extensionPage.evaluate(() => {
                    return chrome.storage.local.get([
                        'recaptcha_auto_open',
                        'recaptcha_auto_solve'
                    ]);
                });
                
                this.log('🔍 Финальная проверка после перезагрузки:', 'info');
                this.log(`   • recaptcha_auto_open: ${finalCheck.recaptcha_auto_open}`, finalCheck.recaptcha_auto_open ? 'success' : 'error');
                this.log(`   • recaptcha_auto_solve: ${finalCheck.recaptcha_auto_solve}`, finalCheck.recaptcha_auto_solve ? 'success' : 'error');

                return true;
            } finally {
                if (extensionPage) {
                    await extensionPage.close().catch(() => {});
                }
            }
        } catch (error) {
            this.log(`Ошибка настройки rektCaptcha: ${error.message}`, 'warning');
            return false;
        }
    }

    async loginToCian() {
        try {
            this.log('🔐 Начинаем авторизацию на CIAN по номеру телефона...');
    
            await this.page.goto('https://www.cian.ru/', { waitUntil: 'networkidle2' });
            await this.delay(2, 4);
    
            // Кликаем на кнопку "Войти"
            this.log('Ищу кнопку "Войти"...');
            await this.page.waitForSelector('[data-name="LoginButton"], a[href*="auth"]', { timeout: 10000 });
            await this.page.click('[data-name="LoginButton"], a[href*="auth"]');
            await this.delay(2, 4);
    
            // ШАГ 1: Ждём МОДАЛЬНОЕ ОКНО авторизации
            this.log('🔍 Ищу модальное окно авторизации...');
            await this.page.waitForSelector('[role="dialog"], .modal, [class*="Modal"]', { timeout: 10000 });
            this.log('✅ Найдено модальное окно');
            await this.delay(2, 4);
    
            // ШАГ 2: Ищем и заполняем поле телефона (по умолчанию показывается)
            this.log('🔍 Ищу поле ввода телефона в модальном окне...');
            try {
                const phoneInput = await this.page.evaluateHandle(() => {
                    const modal = document.querySelector('[role="dialog"]') || 
                                 document.querySelector('.modal') || 
                                 document.querySelector('[class*="Modal"]');
                    
                    if (!modal) return null;
                    
                    return modal.querySelector('input[type="tel"]') || 
                           modal.querySelector('input[name="phone"]') ||
                           modal.querySelector('input[autocomplete="tel"]') ||
                           modal.querySelector('input[placeholder*="телефон"]') ||
                           modal.querySelector('input[placeholder*="Телефон"]') ||
                           modal.querySelector('input[type="text"]');
                });
    
                const phoneElement = phoneInput.asElement();
                if (!phoneElement) {
                    throw new Error('Поле телефона не найдено в модальном окне');
                }
    
                this.log('✅ Найдено поле телефона в модальном окне');
    
                // Форматируем номер: добавляем +7
                const formattedPhone = `+7 (${this.phone.substring(0, 3)}) ${this.phone.substring(3, 6)}-${this.phone.substring(6, 8)}-${this.phone.substring(8, 10)}`;
                this.log(`📱 Ввожу номер: +7 (${this.phone.substring(0, 3)}) ***-**-${this.phone.substring(8, 10)}`);
    
                // Делаем поле видимым и активным
                await phoneElement.evaluate(el => {
                    el.scrollIntoView({ block: 'center' });
                });
                await this.delay(0.5, 0.5);
    
                // Фокусируемся и очищаем
                await phoneElement.focus();
                await this.delay(0.3, 0.3);
    
                await phoneElement.evaluate(el => el.value = '');
                await this.delay(0.2, 0.2);
    
                // Вводим номер ПОСИМВОЛЬНО с задержками (как человек)
                for (const char of formattedPhone) {
                    await phoneElement.type(char, { delay: Math.random() * 100 + 50 });
                }
    
                await this.delay(0.5, 1);
                this.log('✅ Номер телефона введён посимвольно');
            } catch (e) {
                this.log(`❌ Ошибка ввода телефона: ${e.message}`, 'error');
                await this.page.screenshot({ path: 'phone_input_error.png' });
                throw e;
            }
    
            // ШАГ 3: Нажимаем "Получить код"
            this.log('🔍 Ищу кнопку "Получить код" в модальном окне...');
            const clickedGetCode = await this.page.evaluate(() => {
                const modal = document.querySelector('[role="dialog"]') || 
                             document.querySelector('.modal') || 
                             document.querySelector('[class*="Modal"]');
                
                if (modal) {
                    const buttons = Array.from(modal.querySelectorAll('button'));
                    const getCodeBtn = buttons.find(btn => 
                        btn.textContent.includes('Получить код') || 
                        btn.textContent.includes('получить код') ||
                        btn.type === 'submit'
                    );
                    
                    if (getCodeBtn) {
                        getCodeBtn.click();
                        return true;
                    }
                }
                return false;
            });
    
            if (!clickedGetCode) {
                this.log('❌ Кнопка "Получить код" не найдена!', 'error');
                await this.page.screenshot({ path: 'get_code_not_found.png' });
                throw new Error('Кнопка "Получить код" не найдена');
            }
    
            this.log('✅ Кнопка "Получить код" нажата!');
            this.log('📨 Код отправлен на номер +7 (***) ***-**-' + this.phone.substring(8, 10));
            await this.delay(2, 4);
    
            // ШАГ 4: Запрашиваем код у пользователя через Telegram и ждём ввода
            this.log('⏳ Жду ввода кода подтверждения от пользователя...');
    
            if (!this.onCodeRequest) {
                throw new Error('Callback onCodeRequest не настроен! Не могу запросить код у пользователя.');
            }
    
            // Запрашиваем код у пользователя через callback (Telegram бот)
            const code = await this.onCodeRequest();
    
            if (!code || code.length < 4) {
                throw new Error('Получен неверный код подтверждения');
            }
    
            this.log(`✅ Получен код от пользователя: ${code.substring(0, 2)}**`);
    
            // ШАГ 5: Ищем поле для ввода кода
            this.log('🔍 Ищу поле для ввода кода...');
            try {
                await this.delay(2, 3); // Даем время загрузиться полю для кода
    
                const codeInput = await this.page.evaluateHandle(() => {
                    const modal = document.querySelector('[role="dialog"]') || 
                                 document.querySelector('.modal') || 
                                 document.querySelector('[class*="Modal"]');
                    
                    if (!modal) return null;
                    
                    return modal.querySelector('input[placeholder*="код"]') ||
                           modal.querySelector('input[placeholder*="Код"]') ||
                           modal.querySelector('input[name="code"]') ||
                           modal.querySelector('input[type="text"]');
                });
    
                const codeElement = codeInput.asElement();
                if (!codeElement) {
                    throw new Error('Поле для ввода кода не найдено');
                }
    
                this.log('✅ Найдено поле для ввода кода');
    
                // Делаем поле видимым и активным
                await codeElement.evaluate(el => {
                    el.scrollIntoView({ block: 'center' });
                });
                await this.delay(0.5, 0.5);
    
                // Фокусируемся и очищаем
                await codeElement.focus();
                await this.delay(0.3, 0.3);
    
                await codeElement.evaluate(el => el.value = '');
                await this.delay(0.2, 0.2);
    
                // Вводим код ПОСИМВОЛЬНО с задержками
                this.log('🔢 Ввожу код подтверждения...');
                for (const char of code) {
                    await codeElement.type(char, { delay: Math.random() * 100 + 50 });
                }
    
                await this.delay(0.5, 1);
                this.log('✅ Код введён посимвольно');
            } catch (e) {
                this.log(`❌ Ошибка ввода кода: ${e.message}`, 'error');
                await this.page.screenshot({ path: 'code_input_error.png' });
                throw e;
            }
    
            // ШАГ 6: Выбор аккаунта (второй вариант)
            this.log('🔍 Ищу модальное окно выбора аккаунта...');
            const accountChoiceModal = await this.page.waitForSelector('div[role="dialog"], .modal, [class*="Modal"]', { timeout: 10000 });
            if (!accountChoiceModal) {
                this.log('❌ Модальное окно выбора аккаунта не найдено', 'error');
                throw new Error('Модальное окно выбора аккаунта не найдено');
            }
    
            // Ищем второй аккаунт
            this.log('🔍 Ищу второй аккаунт...');
            const secondAccountButton = await this.page.evaluateHandle(() => {
                const accountButtons = Array.from(document.querySelectorAll('button.x52a3aa3b--e19165--btn'));
                return accountButtons.find(button => {
                    const emailText = button.querySelector('span.x52a3aa3b--d95e31--account-content--email')?.textContent.trim();
                    return emailText === 'ALEXANERDMITRIEV9910019876@yandex.ru'; // Второй аккаунт
                });
            });
    
            if (!secondAccountButton) {
                this.log('❌ Второй аккаунт не найден', 'error');
                throw new Error('Не найден второй аккаунт');
            }
    
            await secondAccountButton.click();
            this.log('✅ Второй аккаунт выбран');
    
            // ШАГ 7: Ввод пароля
            this.log('🔍 Ищу поле ввода пароля...');
            const passwordInput = await this.page.waitForSelector('input[name="password"]', { timeout: 10000 });
            if (!passwordInput) {
                this.log('❌ Поле для ввода пароля не найдено', 'error');
                throw new Error('Поле для ввода пароля не найдено');
            }
    
            await passwordInput.focus();
            await this.delay(0.3, 0.3);
            await passwordInput.evaluate(el => el.value = '');
            await this.delay(0.2, 0.2);
    
            const password = 'Alex3310';
            this.log(`🔑 Вводим пароль: ${password}`);
            await passwordInput.type(password, { delay: Math.random() * 100 + 50 });
            await this.delay(0.5, 1);
    
            // Нажимаем кнопку "Войти"
            const loginButton = await this.page.$('button[data-name="LoginBtn"]');
            if (!loginButton) {
                this.log('❌ Кнопка "Войти" не найдена', 'error');
                throw new Error('Кнопка "Войти" не найдена');
            }
    
            await loginButton.click();
            this.log('✅ Кнопка "Войти" нажата');
    
            // ШАГ 8: Ждем завершения авторизации
            this.log('⏳ Жду завершения авторизации...');
            await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
    
            this.log('✅ Авторизация успешна!');
            return true;
    
        } catch (error) {
            this.log(`Ошибка авторизации: ${error.message}`, 'error');
            return false;
        }
    }
    
    

    async applyFiltersViaUI() {
        try {
            this.log('🔧 Применение фильтров через UI...');

            // Ждем и кликаем "Ещё фильтры"
            this.log('Ищу кнопку "Ещё фильтры"...');
            await this.delay(2, 3); // Даем странице загрузиться
            
            const clickedMoreFilters = await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const moreFiltersBtn = buttons.find(btn => 
                    btn.textContent.includes('Ещё фильтры') || 
                    btn.textContent.includes('ещё фильтры')
                );
                if (moreFiltersBtn) {
                    moreFiltersBtn.click();
                    return true;
                }
                return false;
            });
            
            if (!clickedMoreFilters) {
                throw new Error('Кнопка "Ещё фильтры" не найдена');
            }
            await this.delay(2, 4);

            // Ждем модальное окно
            const modalHandle = await this.page.waitForSelector('[data-name="Modal"], [role="dialog"]', { timeout: 10000 });
            if (!modalHandle) {
                throw new Error('Модальное окно с фильтрами не появилось');
            }
            this.log('Модальное окно открыто');

            // Кликаем "Собственник"
            this.log('Применяю фильтр "Собственник"...');
            try {
                await this.page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('span'));
                    const ownerElement = elements.find(el => el.textContent.trim() === 'Собственник');
                    if (ownerElement) ownerElement.click();
                });
                this.log('Фильтр "Собственник" применен', 'success');
                await this.delay(1, 2);
            } catch (e) {
                this.log('Фильтр "Собственник" не найден', 'warning');
            }

            // Скроллим и кликаем "Не показывать" для долей
            this.log('Применяю фильтр "Без долей"...');
            try {
                await this.page.evaluate(() => {
                    const modal = document.querySelector('[data-name="Modal"], [role="dialog"]');
                    if (modal) {
                        modal.scrollTop += 500;
                    }
                });
                await this.delay(0.5, 1);

                await this.page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('span'));
                    const sharesHeader = elements.find(el => el.textContent.trim() === 'Доли');
                    if (sharesHeader) {
                        const parent = sharesHeader.closest('[class*="container"], [class*="section"]');
                        if (parent) {
                            const noSharesElement = Array.from(parent.querySelectorAll('span'))
                                .find(el => el.textContent.trim() === 'Не показывать');
                            if (noSharesElement) noSharesElement.click();
                        }
                    }
                });
                this.log('Фильтр "Без долей" применен', 'success');
                await this.delay(1, 2);
            } catch (e) {
                this.log('Фильтр "Без долей" не найден', 'warning');
            }

            // Закрываем модальное окно
            this.log('Закрываю модальное окно...');
            const clickedShow = await this.page.evaluate(modal => {
                if (!modal) return false;
                const buttons = Array.from(modal.querySelectorAll('button')).filter(btn => btn.offsetParent !== null);
                const priorityOrder = [
                    'Показать объекты',
                    'Показать',
                    'Применить'
                ];

                const normalize = text => (text || '').trim();
                let showBtn = null;

                for (const label of priorityOrder) {
                    showBtn = buttons.find(btn => normalize(btn.textContent).includes(label));
                    if (showBtn) break;
                }

                if (!showBtn) {
                    showBtn = buttons.find(btn => btn.type === 'submit');
                }

                if (showBtn) {
                    showBtn.click();
                    return true;
                }
                return false;
            }, modalHandle);
            
            if (!clickedShow) {
                this.log('Кнопка "Показать" не найдена, пробую ESC...', 'warning');
                await this.page.keyboard.press('Escape');
            }
            await this.delay(3, 5);

            this.log('ФИЛЬТРЫ ПРИМЕНЕНЫ!', 'success');
            return true;
        } catch (error) {
            this.log(`Ошибка применения фильтров: ${error.message}`, 'error');
            return false;
        }
    }

    async findMessageButtons() {
        try {
            this.log('🔍 Прокручиваю страницу для загрузки всех объявлений...');
            
            // Прокручиваем страницу МЕДЛЕННО для загрузки всех карточек
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 3);
            });
            await this.delay(2, 3);
            
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 2);
            });
            await this.delay(2, 3);
            
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await this.delay(3, 4);
            
            await this.page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            await this.delay(2, 3);
            
            this.log('✅ Прокрутка завершена, ищу кнопки...');

            const buttonsData = await this.page.evaluate(() => {
                const extractIdFromUrl = (url) => {
                    if (!url) return null;
                    try {
                        const cleaned = url.split('?')[0];
                        const parts = cleaned.split('/').filter(Boolean);
                        for (let i = parts.length - 1; i >= 0; i--) {
                            const part = parts[i];
                            if (/^\d+$/.test(part)) {
                                return part;
                            }
                        }
                        const digits = cleaned.match(/\d{4,}/g);
                        return digits ? digits[digits.length - 1] : null;
                    } catch {
                        return null;
                    }
                };

                const extractIdFromAttributes = (card) => {
                    if (!card) return null;
                    const dataset = card.dataset || {};
                    const attributeCandidates = [
                        dataset.id,
                        dataset.offerId,
                        dataset.cianId,
                        dataset.objectId,
                        card.getAttribute('data-id'),
                        card.getAttribute('data-offer-id'),
                        card.getAttribute('data-cian-id'),
                        card.getAttribute('data-product-id'),
                        card.getAttribute('data-object-id')
                    ].filter(Boolean);

                    for (const candidate of attributeCandidates) {
                        const id = extractIdFromUrl(candidate) || (/\d+/.test(candidate) ? candidate.match(/\d+/)[0] : null);
                        if (id) return id;
                    }
                    return null;
                };

                const linkSelectors = [
                    'a[href*="/rent/flat/"]',
                    'a[href*="/sale/flat/"]',
                    'a[href*="/flat/"]',
                    'a[href*="/cat.php"]',
                    '[data-name="LinkArea"] a',
                    '[data-name="CardTitle"] a',
                    'a[data-name="CardTitle"]',
                    'a[data-name="LinkArea"]'
                ];

                const findAdLink = (card) => {
                    for (const selector of linkSelectors) {
                        const link = card.querySelector(selector);
                        if (link && link.href) {
                            return link;
                        }
                    }
                    return null;
                };

                const cards = document.querySelectorAll('[data-name="CardComponent"], .card, [data-testid*="offer-card"], article');
                console.log(`🔍 Найдено ${cards.length} карточек на странице`);
                const buttons = [];

                cards.forEach((card, index) => {
                    try {
                        const link = findAdLink(card);
                        const adUrl = link ? link.href : '';
                        let adId = extractIdFromUrl(adUrl);
                        if (!adId) {
                            adId = extractIdFromAttributes(card);
                        }
                        if (!adId && link) {
                            adId = extractIdFromAttributes(link);
                        }

                        if (!adId) {
                            const buttonWithDataset = card.querySelector('button[data-id], button[data-offer-id], button[data-cian-id]');
                            if (buttonWithDataset) {
                                adId = extractIdFromAttributes(buttonWithDataset);
                            }
                        }

                        if (!adId) {
                            adId = `temp_${index}`;
                        }

                        const geoLabels = card.querySelectorAll('[data-name="GeoLabel"]');
                        let address = 'Не указано';
                        if (geoLabels.length > 0) {
                            const parts = Array.from(geoLabels)
                                .map(el => (el.textContent || '').trim())
                                .filter(text => text);
                            if (parts.length > 0) {
                                address = parts.slice(0, 3).join(', ');
                            }
                        }

                        if (address === 'Не указано') {
                            const addressSpan = card.querySelector('[class*="geo"], [data-name="Address"]');
                            if (addressSpan) address = (addressSpan.textContent || '').trim();
                        }

                        let price = 'Не указано';
                        const priceEl = card.querySelector('[data-mark="MainPrice"], [data-testid*="price"], [class*="price"]');
                        if (priceEl) {
                            price = (priceEl.textContent || '').trim();
                        }

                        const allButtons = Array.from(card.querySelectorAll('button'));
                        const writeButton = allButtons.find(btn => {
                            const text = (btn.textContent || '').toLowerCase();
                            return text.includes('написать') ||
                                text.includes('связаться') ||
                                text.includes('message') ||
                                text.includes('отправить');
                        });

                        if (writeButton) {
                            buttons.push({
                                adId,
                                address,
                                price,
                                cardIndex: index,
                                buttonText: (writeButton.textContent || '').trim()
                            });
                            console.log(`✅ Объявление #${buttons.length}: ${adId} - ${address}`);
                        }
                    } catch (e) {
                        console.error('Ошибка обработки карточки:', e.message);
                    }
                });

                console.log(`✅ Итого найдено кнопок "Написать": ${buttons.length}`);
                return buttons;
            });

            this.log(`✅ Найдено ${buttonsData.length} кнопок "Написать"`, buttonsData.length > 0 ? 'success' : 'warning');
            
            // Выводим детали для отладки
            if (buttonsData.length === 0) {
                this.log('⚠️ КНОПКИ НЕ НАЙДЕНЫ! Сохраняю скриншот для отладки...', 'warning');
                await this.page.screenshot({ path: `no_buttons_${Date.now()}.png` });
            }
            
            return buttonsData;
        } catch (error) {
            this.log(`Ошибка поиска кнопок: ${error.message}`, 'error');
            return [];
        }
    }

    // Все функции работы с API 2Captcha удалены - капча решается расширением rektCaptcha

    async checkRektCaptchaActive() {
        try {
            // Проверяем, что расширение загружено
            if (!this.rektCaptcha?.extensionId) {
                this.log('⚠️ ID расширения rektCaptcha не определён', 'warning');
                return false;
            }

            // Проверяем, что content script загружен на странице
            const isActive = await this.page.evaluate(() => {
                // Проверяем наличие признаков работы расширения
                return new Promise((resolve) => {
                    // Ищем признаки rektCaptcha
                    const checkInterval = setInterval(() => {
                        // Проверяем, есть ли изменения от расширения
                        const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"]');
                        if (recaptchaIframe) {
                            clearInterval(checkInterval);
                            resolve(true);
                        }
                    }, 100);

                    // Таймаут 2 секунды
                    setTimeout(() => {
                        clearInterval(checkInterval);
                        resolve(false);
                    }, 2000);
                });
            });

            if (isActive) {
                this.log('✅ Расширение rektCaptcha активно на странице', 'success');
            } else {
                this.log('⚠️ Расширение rektCaptcha может быть неактивно', 'warning');
            }

            return isActive;
        } catch (error) {
            this.log(`Ошибка проверки активности расширения: ${error.message}`, 'warning');
            return false;
        }
    }

    async ensureRektCaptchaStoragePage() {
        if (!this.browser || !this.rektCaptcha?.extensionPath) {
            return null;
        }

        if (this.rektCaptcha.storagePage && !this.rektCaptcha.storagePage.isClosed()) {
            return this.rektCaptcha.storagePage;
        }

        const extensionId = await this.getRektCaptchaExtensionId();
        if (!extensionId) {
            return null;
        }

        const pageUrl = `chrome-extension://${extensionId}/${this.rektCaptcha.popupPage || 'popup.html'}`;
        let storagePage = null;

        try {
            storagePage = await this.browser.newPage();
            await storagePage.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
            this.rektCaptcha.storagePage = storagePage;
            this.rektCaptcha.storageWarningShown = false;
            return storagePage;
        } catch (error) {
            if (storagePage) {
                await storagePage.close().catch(() => {});
            }
            if (!this.rektCaptcha.storageWarningShown) {
                this.log(`⚠️ Не удалось открыть страницу rektCaptcha для чтения storage: ${error.message}`, 'warning');
                this.rektCaptcha.storageWarningShown = true;
            }
            this.rektCaptcha.storagePage = null;
            return null;
        }
    }

    async getRektCaptchaStorage(keys = []) {
        try {
            const storagePage = await this.ensureRektCaptchaStoragePage();
            if (!storagePage) {
                return null;
            }

            const data = await storagePage.evaluate(requestedKeys => {
                const keysToRequest = Array.isArray(requestedKeys) && requestedKeys.length > 0
                    ? requestedKeys
                    : null;

                return new Promise((resolve, reject) => {
                    try {
                        chrome.storage.local.get(keysToRequest, result => {
                            const err = chrome.runtime.lastError;
                            if (err) {
                                reject(err.message || String(err));
                                return;
                            }
                            resolve(result);
                        });
                    } catch (storageError) {
                        reject(storageError.message || String(storageError));
                    }
                });
            }, keys);

            if (data) {
                this.rektCaptcha.storageWarningShown = false;
            }

            return data;
        } catch (error) {
            if (!this.rektCaptcha.storageWarningShown) {
                this.log(`⚠️ Ошибка чтения chrome.storage rektCaptcha: ${error}`, 'warning');
                this.rektCaptcha.storageWarningShown = true;
            }

            if (this.rektCaptcha.storagePage && !this.rektCaptcha.storagePage.isClosed()) {
                try {
                    await this.rektCaptcha.storagePage.close();
                } catch {}
            }
            this.rektCaptcha.storagePage = null;
            return null;
        }
    }

    async isRecaptchaSolvedInFrame(frame) {
        if (!frame) {
            return false;
        }

        try {
            return await frame.evaluate(() => {
                const tokenSelectors = [
                    'textarea[name="g-recaptcha-response"]',
                    'textarea#g-recaptcha-response',
                    'input[name="g-recaptcha-response"]',
                    'input#g-recaptcha-response'
                ];

                for (const selector of tokenSelectors) {
                    const field = document.querySelector(selector);
                    if (field && typeof field.value === 'string' && field.value.trim().length > 0) {
                        return true;
                    }
                }

                const checkbox = document.querySelector('div[role="checkbox"][aria-checked="true"]');
                if (checkbox) {
                    return true;
                }

                return false;
            });
        } catch (error) {
            return false;
        }
    }

    async waitForRektCaptchaSolve(frame, options = {}) {
        const timeoutMs = options.timeoutMs ?? 60000;
        const pollIntervalMs = options.pollIntervalMs ?? 1000;

        let storageBaseline = 0;
        let storageAvailable = false;

        if (this.rektCaptcha?.extensionPath) {
            const initialData = await this.getRektCaptchaStorage(['rektcaptcha_last_solved_at']);
            if (initialData && initialData.rektcaptcha_last_solved_at) {
                storageBaseline = Number(initialData.rektcaptcha_last_solved_at) || 0;
                storageAvailable = true;
            }
        }

        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const solvedViaDom = await this.isRecaptchaSolvedInFrame(frame);
            if (solvedViaDom) {
                this.log('✅ reCAPTCHA подтверждена (обнаружен токен на странице)', 'success');
                return true;
            }

            if (this.rektCaptcha?.extensionPath) {
                const storageData = await this.getRektCaptchaStorage(['rektcaptcha_status', 'rektcaptcha_last_solved_at']);
                if (storageData) {
                    storageAvailable = true;
                    const status = storageData.rektcaptcha_status;
                    const lastSolvedAt = Number(storageData.rektcaptcha_last_solved_at) || 0;

                    if (status === 'solved' && lastSolvedAt) {
                        if (!storageBaseline || lastSolvedAt > storageBaseline) {
                            this.log('✅ rektCaptcha сообщила о решении reCAPTCHA через storage', 'success');
                            return true;
                        }
                    }
                } else if (storageAvailable) {
                    storageAvailable = false;
                }
            }

            await this.delay(pollIntervalMs / 1000, pollIntervalMs / 1000);
        }

        this.log('⚠️ Не дождался подтверждения решения reCAPTCHA (таймаут 60 секунд)', 'warning');
        return false;
    }

    async clickSendButton(frame, attempt = 0) {
        try {

            // Используем evaluate для поиска и клика по кнопке (работает даже с zoom)
            const clicked = await frame.evaluate(() => {
                const selectors = [
                    '[data-testid="send_button"]',
                    '[data-name="MessageInputField_send_button"]',
                    'button[class*="MessageInputField_send_button"]',
                    'button[type="submit"]'
                ];

                // Пробуем найти по селекторам
                for (const selector of selectors) {
                    const btn = document.querySelector(selector);
                    if (btn) {
                        btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                        btn.click();
                        return true;
                    }
                }

                // Fallback: ищем по тексту
                const buttons = Array.from(document.querySelectorAll('button'));
                const sendBtn = buttons.find(btn => {
                    const text = (btn.textContent || '').toLowerCase();
                    return text.includes('отправить') || text.includes('send');
                });

                if (sendBtn) {
                    sendBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
                    sendBtn.click();
                    return true;
                }

                return false;
            });

            if (!clicked) {
                this.log('❌ Кнопка "Отправить" не найдена', 'error');
                if (attempt < 1) {
                    this.log('⏳ Жду 30 секунд перед повторным поиском кнопки', 'warning');
                    await this.delay(30, 30);
                    return this.clickSendButton(frame, attempt + 1);
                }
                return false;
            }

            this.log('📨 Нажал кнопку "Отправить" (попытка #' + (attempt + 1) + ')', 'success');

            if (attempt < 1) {
                this.log('⏳ Ожидаю подтверждение решения reCAPTCHA через расширение...', 'info');
                const solved = await this.waitForRektCaptchaSolve(frame, {
                    timeoutMs: 60000,
                    pollIntervalMs: 1000
                });

                if (solved) {
                    this.log('⏳ Жду 3 секунды перед вторым нажатием "Отправить"', 'info');
                    await this.delay(3, 3);
                } else {
                    this.log('⚠️ Не получил подтверждение решения, жду 3 секунды и всё равно пробую ещё раз', 'warning');
                    await this.delay(3, 3);
                }

                return this.clickSendButton(frame, attempt + 1);
            }

            await this.delay(3, 3);

            return true;
        } catch (error) {
            this.log(`❌ Ошибка при нажатии кнопки "Отправить": ${error.message}`, 'error');
            if (attempt < 1) {
                this.log('⏳ Жду 10 секунд и повторяю попытку отправки', 'warning');
                await this.delay(10, 10);
                return this.clickSendButton(frame, attempt + 1);
            }
            return false;
        }
    }

    async waitForOutgoingMessage(frame, messageText, options = {}) {
        const {
            timeoutMs = 9000,
            checkIntervalMs = 600
        } = options;

        const normalizedTarget = typeof messageText === 'string'
            ? messageText.replace(/\s+/g, ' ').trim().toLowerCase()
            : '';

        const deadline = Date.now() + Math.max(0, timeoutMs);

        while (Date.now() < deadline) {
            const found = await frame.evaluate(targetText => {
                const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
                const selectors = [
                    '[data-name*=\"Message\"]',
                    '[data-testid*=\"message\"]',
                    'div[class*=\"Message\"]',
                    'div[class*=\"message\"]',
                    '.message',
                    '.chat-message'
                ];

                const outgoingHints = ['out', 'owner', 'my', 'me'];

                const elements = [];
                const seen = new Set();
                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(element => {
                        if (!element || seen.has(element)) return;
                        seen.add(element);
                        elements.push(element);
                    });
                });

                for (const element of elements) {
                    const text = normalize(element.textContent);
                    if (!text) continue;

                    if (targetText) {
                        if (text.includes(targetText)) {
                            return true;
                        }
                    } else {
                        const classCandidate = typeof element.className === 'string'
                            ? element.className
                            : (element.getAttribute && element.getAttribute('class')) || '';
                        const className = normalize(classCandidate);
                        if (outgoingHints.some(hint => className.includes(hint))) {
                            return true;
                        }
                    }
                }

                return false;
            }, normalizedTarget);

            if (found) {
                return true;
            }

            await this.delay(checkIntervalMs / 1000, checkIntervalMs / 1000);
        }

        return false;
    }

    async findMessageInput(frame) {
        const selectors = [
            'textarea[data-name="MessageInputField_textarea"]',
            'textarea[placeholder="Написать сообщение"]',
            'textarea[placeholder*="Напишите"]',
            'textarea[placeholder*="Написать"]',
            'textarea',
            'div[contenteditable="true"]',
            'input[type="text"][placeholder*="Напишите"]',
            'input[type="text"][placeholder*="Сообщение"]',
            'input[type="text"]'
        ];

        for (const selector of selectors) {
            try {
                const timeout = selector === selectors[0] ? 10000 : 2500;
                this.log(`   • Пробую найти поле селектором "${selector}" (таймаут ${timeout / 1000}с)`);
                const element = await frame.waitForSelector(selector, {
                    timeout,
                    visible: true
                });
                if (!element) continue;

                const info = await element.evaluate((el, usedSelector) => ({
                    tag: el.tagName,
                    placeholder: el.getAttribute('placeholder') || '',
                    maxLength: typeof el.maxLength === 'number' && el.maxLength > 0 ? el.maxLength : null,
                    isVisible: !!(el.offsetParent || el.getClientRects().length),
                    isEnabled: !el.disabled,
                    isContentEditable: !!el.isContentEditable,
                    selector: usedSelector
                }), selector);

                if (info.isVisible && info.isEnabled) {
                    return { element, info };
                }

                await element.dispose();
            } catch (error) {
                // Продолжаем пробовать следующие селекторы
            }
        }

        return null;
    }

    async fillMessageField(frame, element, messageText, fieldInfo) {
        try {
            await element.evaluate(el => {
                el.scrollIntoView({ block: 'center' });
            });
            await this.delay(0.3, 0.5);
            await element.evaluate(el => el.focus());
            await this.delay(0.1, 0.2);

            if (fieldInfo.isContentEditable) {
                await frame.evaluate((el, text) => {
                    el.focus();
                    el.innerHTML = '';
                    const textNode = document.createTextNode(text);
                    el.appendChild(textNode);
                    const inputEvent = typeof InputEvent === 'function'
                        ? new InputEvent('input', { bubbles: true })
                        : new Event('input', { bubbles: true });
                    el.dispatchEvent(inputEvent);
                }, element, messageText);
            } else if (fieldInfo.tag === 'INPUT') {
                try {
                    await element.click({ clickCount: 3 });
                } catch (error) {
                    await element.click().catch(() => {});
                }
                await this.delay(0.2, 0.4);
                await element.type(messageText, { delay: Math.random() * 100 + 50 });
            } else {
                await element.click().catch(() => {});
                await this.delay(0.2, 0.4);
                await frame.evaluate((el, text) => {
                    el.focus();
                    const execSupported = typeof document.execCommand === 'function';
                    if (execSupported) {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, text);
                    }
                    if (!el.value || el.value.length < text.length / 2) {
                        el.value = text;
                    }
                    const event = typeof InputEvent === 'function'
                        ? new InputEvent('input', { bubbles: true })
                        : new Event('input', { bubbles: true });
                    el.dispatchEvent(event);
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }, element, messageText);
            }

            const currentLength = await element.evaluate(el => {
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    return (el.value || '').length;
                }
                return (el.innerText || el.textContent || '').length;
            });

            this.log(`📊 В поле оказалось ${currentLength} символов из ${messageText.length}`);
            return currentLength > 0;
        } catch (error) {
            this.log(`Ошибка при вводе сообщения: ${error.message}`, 'error');
            return false;
        }
    }

    async ensureChatClosed(frame) {
        const iframeSelector = 'iframe[data-testid="ChatModal"], iframe[data-name*="Chat"]';

        try {
            if (frame) {
                await frame.evaluate(() => {
                    const selectors = [
                        '[data-name="ChatHeader_close"]',
                        '[data-testid="ChatHeader_close"]',
                        'button[aria-label="Закрыть"]',
                        'button[class*="close"]',
                        '[data-name="ChatHeaderUser"] button'
                    ];

                    for (const selector of selectors) {
                        const btn = document.querySelector(selector);
                        if (btn) {
                            btn.click();
                            return 'button_clicked';
                        }
                    }

                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
                    return 'escape_dispatched';
                }).catch(() => {});
            }
        } catch (error) {
            this.log(`⚠️ Ошибка при попытке закрыть чат кнопкой: ${error.message}`, 'warning');
        }

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await this.page.waitForSelector(iframeSelector, { hidden: true, timeout: 2000 });
                this.log(`✅ Iframe чата скрыт (попытка ${attempt})`);
                return true;
            } catch {
                this.log(`⚠️ Iframe всё ещё виден (попытка ${attempt}), жму Escape`, 'warning');
                try {
                    await this.page.keyboard.press('Escape');
                } catch {}
                await this.delay(0.5, 0.8);
            }
        }

        const forceRemoved = await this.page.evaluate(selector => {
            const iframe = document.querySelector(selector);
            if (iframe && iframe.parentElement) {
                iframe.parentElement.remove();
                return true;
            }
            return false;
        }, iframeSelector);

        if (forceRemoved) {
            this.log('⚠️ Пришлось принудительно удалить iframe из DOM', 'warning');
            return true;
        }

        this.log('❌ Не удалось закрыть iframe чата', 'error');
        return false;
    }

    async processPage(pageNum) {
        try {
            this.log(`\n${'='.repeat(60)}`);
            this.log(`📄 НАЧИНАЮ ОБРАБОТКУ СТРАНИЦЫ ${pageNum}`, 'success');
            this.log(`${'='.repeat(60)}\n`);

            this.currentResultsUrl = this.page.url();
            const buttonsData = await this.findMessageButtons();
            
            if (buttonsData.length === 0) {
                this.log('Кнопки не найдены на странице', 'warning');
                return 0;
            }

            // Дедупликация
            const uniqueButtons = [];
            const seenIds = new Set();
            for (const btn of buttonsData) {
                if (!seenIds.has(btn.adId)) {
                    seenIds.add(btn.adId);
                    uniqueButtons.push(btn);
                }
            }

            // Обрабатываем ВСЕ найденные объявления на странице (не ограничиваем maxPerPage)
            const buttonsToProcess = uniqueButtons;
            this.log(`\n📊 Статистика:`);
            this.log(`   • Всего найдено: ${buttonsData.length}`);
            this.log(`   • Уникальных: ${uniqueButtons.length}`);
            this.log(`   • Будет обработано: ${buttonsToProcess.length} (ВСЕ объявления на странице)\n`);

            if (buttonsToProcess.length === 0) {
                this.log('⚠️ НЕТ ОБЪЯВЛЕНИЙ ДЛЯ ОБРАБОТКИ НА ЭТОЙ СТРАНИЦЕ!', 'warning');
                return 0;
            }

            let processed = 0;
            for (let i = 0; i < buttonsToProcess.length; i++) {
                const btnData = buttonsToProcess[i];
                
                this.log(`\n${'='.repeat(60)}`);
                this.log(`📨 ОБЪЯВЛЕНИЕ ${i + 1}/${buttonsToProcess.length}`, 'success');
                this.log(`${'='.repeat(60)}`);
                this.log(`   ID: ${btnData.adId}`);
                this.log(`   📍 Адрес: ${btnData.address}`);
                this.log(`   💰 Цена: ${btnData.price}`);
                this.log(`   🔘 Кнопка: "${btnData.buttonText}"`);
                this.notify('ad-start', {
                    index: i + 1,
                    total: buttonsToProcess.length,
                    adId: btnData.adId,
                    address: btnData.address,
                    price: btnData.price
                });

                // Проверяем, обработано ли
                if (!this.alwaysProcess && this.isProcessed(btnData.adId)) {
                    this.log('УЖЕ ОБРАБОТАНО РАНЕЕ - пропускаю', 'warning');
                    continue;
                }

                try {
                    // Находим кнопку заново (для актуальности)
                    const cards = await this.page.$$('[data-name="CardComponent"], .card, [data-testid*="offer-card"]');
                    if (typeof btnData.cardIndex !== 'number' || btnData.cardIndex >= cards.length) {
                        this.log('Карта объявления не найдена по индексу', 'warning');
                        continue;
                    }
                    
                    const card = cards[btnData.cardIndex];
                    const button = await this.getWriteButtonFromCard(card);
                    
                    if (!button) {
                        this.log('Кнопка не найдена', 'warning');
                        continue;
                    }

                    // Скроллим к кнопке и кликаем
                    await button.scrollIntoView({ block: 'center' });
                    await this.delay(0.3, 0.7);
                    
                    this.log('Кликаю "Написать"...');
                    await button.click();

                    // ШАГ 1: Ждём появления iframe с чатом (ТОЧНО КАК В PYTHON)
                    this.log('⏳ Жду появления iframe чата (макс 8 сек)...');
                    let frame = null;
                    
                    try {
                        const iframeSelectors = [
                            'iframe[data-testid="ChatModal"]',
                            'iframe[data-name*="Chat"]',
                            '#frontend-serp iframe[data-testid="ChatModal"]',
                            '#frontend-serp iframe[data-name*="Chat"]',
                            'iframe[src*="/dialogs?"]'
                        ];

                        let iframeHandle = null;
                        let clickRetries = 0;

                        while (!iframeHandle && clickRetries < 2) {
                            for (const selector of iframeSelectors) {
                                try {
                                    const handle = await this.page.waitForSelector(selector, { timeout: 6000 });
                                    if (handle) {
                                        const stillExists = await handle.evaluate(el => !!el && el.isConnected).catch(() => false);
                                        if (stillExists) {
                                            iframeHandle = handle;
                                            break;
                                        }
                                    }
                                } catch {
                                    // try next selector
                                }
                            }

                            if (!iframeHandle) {
                                clickRetries += 1;
                                this.log(`⚠️ Iframe не найден (попытка ${clickRetries}), повторно кликаю "Написать"`, 'warning');
                                try {
                                    await button.click();
                                } catch {
                                    await this.page.evaluate(el => el.click(), button).catch(() => {});
                                }
                                await this.delay(1, 2);
                            }
                        }
                        
                        if (!iframeHandle) {
                            this.log('❌ Iframe не появился после повторных попыток!', 'error');
                            await this.page.screenshot({ path: `no_iframe_${btnData.adId}.png` });
                            continue;
                        }
                        
                        this.log('✅ Iframe найден!');
                        
                        // ШАГ 2: Переключаемся в iframe (как в Python: switch_to.frame)
                        this.log('🔄 Переключаюсь в iframe...');
                        frame = await iframeHandle.contentFrame();

                        if (!frame) {
                            this.log('⚠️ contentFrame вернул null, пробую найти iframe снова', 'warning');
                            for (const selector of [
                                'iframe[data-testid="ChatModal"]',
                                'iframe[data-name*="Chat"]',
                                '#frontend-serp iframe[data-testid="ChatModal"]',
                                '#frontend-serp iframe[data-name*="Chat"]',
                                'iframe[src*="/dialogs?"]'
                            ]) {
                                try {
                                    const handle = await this.page.$(selector);
                                    if (handle) {
                                        const exists = await handle.evaluate(el => !!el && el.isConnected).catch(() => false);
                                        if (exists) {
                                            iframeHandle = handle;
                                            break;
                                        }
                                    }
                                } catch {}
                            }
                            if (iframeHandle) {
                                frame = await iframeHandle.contentFrame();
                            }
                        }

                        if (!frame) {
                            this.log('❌ Не удалось получить contentFrame!', 'error');
                            continue;
                        }
                        
                        // ШАГ 3: ЖДЁМ ЗАГРУЗКИ СОДЕРЖИМОГО IFRAME (ВАЖНО! Как в Python: time.sleep(5))
                        this.log('⏳ Жду загрузки содержимого iframe (5 секунд)...');
                        await this.delay(5, 5); // Точно 5 секунд как в Python!
                        
                        this.log('✅ Переключился в iframe, содержимое загружено!', 'success');
                        
                    } catch (e) {
                        this.log(`❌ Ошибка поиска/переключения в iframe: ${e.message}`, 'error');
                        await this.page.screenshot({ path: `iframe_error_${Date.now()}.png` });
                        continue;
                    }

                    // ШАГ 4: Проверяем что поле готово (как в Python)
                    this.log('🔍 Проверяю наличие существующего диалога...');
                    try {
                        const existingMessages = await frame.$$('[data-name*="Message"], .message, [class*="message"]');
                        if (existingMessages.length > 3) { // Больше 3 элементов = есть история (как в Python)
                            this.log(`⏭️  ДИАЛОГ УЖЕ СУЩЕСТВУЕТ (${existingMessages.length} сообщений) - пропускаю!`, 'warning');
                            await this.saveProcessedId(btnData.adId);
                            // НЕ закрываем iframe - просто переходим к следующему
                            continue;
                        }
                    } catch (e) {
                        // Игнорируем ошибки проверки истории
                    }

                    // ШАГ 5: Ищем поле ввода внутри iframe
                    this.log('🔍 Ищу поле ввода внутри iframe...');
                    let messageFieldData = null;
                    let messageField = null;
                    let fieldInfo = null;
                    
                    try {
                        messageFieldData = await this.findMessageInput(frame);
                        if (!messageFieldData) {
                            this.log('❌ Поле ввода не найдено внутри iframe!', 'error');
                            await this.page.screenshot({ path: `no_textarea_${btnData.adId}.png` });
                            // Пропускаем без закрытия iframe
                            continue;
                        }
                        
                        messageField = messageFieldData.element;
                        fieldInfo = messageFieldData.info;
                        
                        this.log('✅ Поле для сообщения найдено', 'success');
                        this.log('📋 Информация о поле:');
                        this.log(`   • Селектор: ${fieldInfo.selector}`);
                        this.log(`   • Тип: ${fieldInfo.tag}${fieldInfo.isContentEditable ? ' (contenteditable)' : ''}`);
                        this.log(`   • Placeholder: ${fieldInfo.placeholder}`);
                        this.log(`   • MaxLength: ${fieldInfo.maxLength || '—'}`);
                        this.log(`   • Видимость: ${fieldInfo.isVisible}`);
                        this.log(`   • Активность: ${fieldInfo.isEnabled}`);
                        
                        if (!fieldInfo.isVisible || !fieldInfo.isEnabled) {
                            this.log('❌ Поле не готово к вводу!', 'error');
                            // Пропускаем без закрытия iframe
                            continue;
                        }
                        
                        this.log('✅ Поле ГОТОВО к вводу!', 'success');
                        
                    } catch (e) {
                        this.log(`❌ Ошибка при поиске поля ввода: ${e.message}`, 'error');
                        await this.page.screenshot({ path: `textarea_error_${Date.now()}.png` });
                        // Пропускаем без закрытия iframe
                        continue;
                    }
                    
                    // Выбираем случайный вариант сообщения
                    const messageText = this.messageVariants[Math.floor(Math.random() * this.messageVariants.length)];
                    this.log(`Выбран вариант сообщения: ${this.messageVariants.indexOf(messageText) + 1}/4`);

                    this.log('НАЧИНАЮ ВВОД ТЕКСТА...');
                    
                    const inputFilled = await this.fillMessageField(frame, messageField, messageText, fieldInfo);
                    if (!inputFilled) {
                        this.log('❌ Не удалось ввести текст сообщения', 'error');
                        // Пропускаем без закрытия iframe
                        continue;
                    }
                    
                    this.log('ВВОД ЗАВЕРШЕН!', 'success');
                    await this.delay(2, 3);

                    const sendSuccess = await this.clickSendButton(frame);
                    if (!sendSuccess) {
                        this.log('❌ Не удалось нажать кнопку отправки, пропускаю объявление', 'error');
                        // Пропускаем без закрытия iframe
                        continue;
                    }

                    const messageDelivered = await this.waitForOutgoingMessage(frame, messageText, {
                        timeoutMs: 9000,
                        checkIntervalMs: 600
                    });

                    if (messageDelivered) {
                        this.log('✉️ Сообщение появилось в чате — сразу двигаюсь к следующему объявлению', 'success');
                    } else {
                        this.log('⚠️ Не удалось подтвердить появление сообщения, даю короткую паузу для надёжности', 'warning');
                        await this.delay(3, 4);
                    }

                    if (!messageDelivered) {
                        // Сохраняем скриншот IFRAME (а не всей страницы!) только при проблемах
                        try {
                            const frameElement = await this.page.$('iframe[data-testid="ChatModal"], iframe');
                            if (frameElement) {
                                await frameElement.screenshot({ path: `message_input_${btnData.adId}.png` });
                                this.log(`Скриншот iframe: message_input_${btnData.adId}.png`);
                            }
                        } catch (e) {
                            await this.page.screenshot({ path: `message_input_${btnData.adId}.png` });
                            this.log(`Скриншот страницы: message_input_${btnData.adId}.png`);
                        }
                    }

                    // Сохраняем как обработанный
                    if (!this.alwaysProcess) {
                        await this.saveProcessedId(btnData.adId);
                        this.log(`ID ${btnData.adId} сохранён в список обработанных`, 'success');
                    }
                    this.notify('ad-complete', {
                        adId: btnData.adId,
                        address: btnData.address,
                        price: btnData.price
                    });

                    // НЕ закрываем iframe - просто переходим к следующему объявлению
                    this.log(messageDelivered
                        ? 'Перехожу к следующему объявлению без задержки.'
                        : 'Перехожу к следующему объявлению (iframe остаётся открытым)...');
                    
                    processed++;

                    // Минимальная пауза между объявлениями (для стабильности)
                    if (!messageDelivered && i < buttonsToProcess.length - 1) {
                        const pause = Math.random() * (3 - 1) + 1; // 1-3 секунды
                        this.log(`⏸️ Пауза ${pause.toFixed(1)} сек...`);
                        await this.delay(pause, pause);
                    }
                } catch (error) {
                    this.log(`Ошибка обработки объявления: ${error.message}`, 'error');
                    this.log(`Stack trace: ${error.stack}`, 'error');
                    
                    // Сохраняем скриншот ошибки
                    try {
                        await this.page.screenshot({ path: `error_ad_${btnData.adId}_${Date.now()}.png` });
                        this.log(`Скриншот ошибки сохранен: error_ad_${btnData.adId}_${Date.now()}.png`);
                    } catch (e) {}
                    
                    // НЕ закрываем iframe, просто продолжаем к следующему объявлению
                    continue;
                }
            }

            return processed;
        } catch (error) {
            this.log(`Ошибка обработки страницы: ${error.message}`, 'error');
            return 0;
        }
    }

    async run() {
        try {
            await this.loadProcessedIds();

            if (!await this.initBrowser()) {
                throw new Error('Не удалось запустить браузер');
            }

            const loginSuccess = await this.loginToCian();
            if (!loginSuccess) {
                this.log('❌ АВТОРИЗАЦИЯ НЕ УДАЛАСЬ!', 'error');
                this.log('📸 Проверьте скриншоты: auth_failed.png или auth_not_logged_in.png');
                throw new Error('Не удалось авторизоваться - проверьте номер телефона');
            }
            
            this.log('✅ Авторизация подтверждена!');
            
            // Проверяем наличие вариантов сообщений
            if (!this.messageVariants || this.messageVariants.length === 0) {
                this.log('⚠️ Варианты сообщений не заданы, используются дефолтные');
                this.messageVariants = [
                    'Здравствуйте! Интересует ваше объявление.',
                    'Добрый день! Хотел бы узнать подробнее о вашем объявлении.',
                    'Здравствуйте! Можно уточнить детали по объявлению?'
                ];
            } else {
                this.log(`✅ Используются ${this.messageVariants.length} вариантов сообщений из конфига`);
            }
            
            await this.delay(2, 3);


            

            // Открываем страницу поиска
            this.searchBaseUrl = this.normalizeSearchBaseUrl(this.searchUrl);
            const firstPageUrl = this.composeSearchUrlForPage(1);
            this.log(`🌐 Открываю страницу поиска...`);
            await this.page.goto(firstPageUrl, { waitUntil: 'networkidle2' });
            this.currentResultsUrl = this.page.url();
            this.searchBaseUrl = this.normalizeSearchBaseUrl(this.currentResultsUrl || this.searchUrl);
            await this.delay(3, 5);

            // Обрабатываем страницы
            let totalProcessed = 0;
            const maxPagesLimit = Number.isFinite(this.maxPages) ? this.maxPages : null;
            let currentPage = 1;

            while (true) {
                if (maxPagesLimit && currentPage > maxPagesLimit) {
                    break;
                }

                if (currentPage > 1) {
                    const navigated = await this.navigateToResultsPage(currentPage);
                    if (!navigated) {
                        this.log('⚠️ Не удалось перейти на следующую страницу, завершаю обход.', 'warning');
                        break;
                    }
                }

                const processed = await this.processPage(currentPage);
                totalProcessed += processed;

                this.log(`\n✅ Страница ${currentPage} завершена: обработано ${processed} объявлений`);
                this.log(`📊 Всего обработано: ${totalProcessed}`);

                if (processed === 0) {
                    this.log('⚠️ На странице не найдено новых объявлений, перехожу к следующей.', 'warning');
                }

                if (maxPagesLimit && currentPage >= maxPagesLimit) {
                    this.log(`⚠️ Достигнут предел maxPages (${maxPagesLimit}). Останавливаю переход по страницам.`, 'warning');
                    break;
                }

                const pause = Math.random() * (10 - 5) + 5;
                this.log(`⏸️ Пауза ${pause.toFixed(1)} сек перед следующей страницей...`);
                await this.delay(pause, pause);

                currentPage += 1;
            }

            this.log(`\n${'='.repeat(60)}`);
            this.log(`✅ ВСЕ СТРАНИЦЫ ОБРАБОТАНЫ!`, 'success');
            this.log(`📊 Итого обработано объявлений: ${totalProcessed}`);
            this.log(`📂 Всего в базе обработанных: ${this.processedIds.size}`);
            this.log(`${'='.repeat(60)}`);

            return { success: true, processed: totalProcessed };
        } catch (error) {
            this.log(`КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`, 'error');
            this.log(`Stack trace: ${error.stack}`, 'error');
            
            // Сохраняем скриншот критической ошибки
            try {
                if (this.page) {
                    await this.page.screenshot({ path: `error_critical_${Date.now()}.png` });
                    this.log(`Скриншот критической ошибки сохранен`);
                }
            } catch (e) {}
            
            return { success: false, error: error.message };
        } finally {
            if (this.browser) {
                this.log('Закрываю браузер через 5 секунд...');
                await this.delay(5, 5);
                await this.browser.close();
            }
            
            // Удаляем временный профиль Chrome для чистого следующего запуска
            if (this.tempProfileDir && fsSync.existsSync(this.tempProfileDir)) {
                try {
                    this.log('🧹 Очищаю временный профиль Chrome...');
                    // Используем рекурсивное удаление
                    const rimraf = (dirPath) => {
                        if (fsSync.existsSync(dirPath)) {
                            const entries = fsSync.readdirSync(dirPath, { withFileTypes: true });
                            for (const entry of entries) {
                                const fullPath = path.join(dirPath, entry.name);
                                if (entry.isDirectory()) {
                                    rimraf(fullPath);
                                } else {
                                    fsSync.unlinkSync(fullPath);
                                }
                            }
                            fsSync.rmdirSync(dirPath);
                        }
                    };
                    
                    rimraf(this.tempProfileDir);
                    this.log('✅ Временный профиль удалён');
                } catch (cleanupError) {
                    this.log(`⚠️ Не удалось удалить временный профиль: ${cleanupError.message}`, 'warning');
                }
            }
        }
    }

    async navigateToResultsPage(pageNumber) {
        const previousUrl = this.page.url();
        const targetUrl = this.composeSearchUrlForPage(pageNumber);

        this.log(`🌐 Пытаюсь перейти на страницу ${pageNumber} по URL ${targetUrl}`);

        let directNavigationSucceeded = false;
        try {
            await this.page.goto(targetUrl, { waitUntil: 'networkidle2' });
            directNavigationSucceeded = true;
        } catch (error) {
            this.log(`⚠️ Прямой переход на ${targetUrl} завершился ошибкой: ${error.message}`, 'warning');
        }

        await this.delay(2, 3);

        this.currentResultsUrl = this.page.url();
        let currentPageNumber = this.getPageNumberFromUrl(this.currentResultsUrl);

        if (directNavigationSucceeded && currentPageNumber === pageNumber) {
            this.log(`✅ Успешно перешёл на страницу ${pageNumber} прямым переходом`);
            this.searchBaseUrl = this.normalizeSearchBaseUrl(this.currentResultsUrl);
            return true;
        }

        this.log(`⚠️ Прямой переход не дал нужного результата (текущий URL: ${this.currentResultsUrl}). Пробую кликнуть по пагинации.`, 'warning');

        const clickSucceeded = await this.clickNextPageButton();
        if (!clickSucceeded) {
            this.log('❌ Не удалось найти кнопку перехода на следующую страницу', 'error');
            return false;
        }

        try {
            await Promise.race([
                this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null),
                this.page.waitForFunction(prev => window.location.href !== prev, { timeout: 15000 }, previousUrl).catch(() => null)
            ]);
        } catch {}

        await this.delay(2, 3);
        this.currentResultsUrl = this.page.url();
        currentPageNumber = this.getPageNumberFromUrl(this.currentResultsUrl);
        this.searchBaseUrl = this.normalizeSearchBaseUrl(this.currentResultsUrl);

        if (currentPageNumber === pageNumber || currentPageNumber === null) {
            this.log(`✅ Перешёл на страницу ${pageNumber} через интерфейс (URL: ${this.currentResultsUrl})`);
            return true;
        }

        this.log(`⚠️ После клика номер страницы ${currentPageNumber}, ожидали ${pageNumber}.`, 'warning');
        return currentPageNumber >= pageNumber;
    }

    composeSearchUrlForPage(pageNumber) {
        const baseUrl = this.searchBaseUrl || this.searchUrl;
        try {
            const url = new URL(baseUrl, 'https://www.cian.ru');
            if (pageNumber <= 1) {
                url.searchParams.delete('p');
            } else {
                url.searchParams.set('p', pageNumber);
            }
            return url.toString();
        } catch (error) {
            this.log(`Не удалось сформировать URL для страницы ${pageNumber}: ${error.message}`, 'warning');
            return baseUrl;
        }
    }

    normalizeSearchBaseUrl(url) {
        try {
            const parsed = new URL(url, 'https://www.cian.ru');
            parsed.searchParams.delete('p');
            let normalized = parsed.toString();
            normalized = normalized.replace(/[?&]$/, '');
            return normalized;
        } catch (error) {
            this.log(`Не удалось нормализовать URL поиска: ${error.message}`, 'warning');
            return url;
        }
    }

    getPageNumberFromUrl(url) {
        try {
            const parsed = new URL(url, 'https://www.cian.ru');
            const pValue = parsed.searchParams.get('p');
            if (pValue) {
                const number = parseInt(pValue, 10);
                return Number.isFinite(number) ? number : null;
            }

            const pathname = parsed.pathname || '';
            if (pathname.includes('snyat-kvartiru') || pathname.includes('cat.php')) {
                return 1;
            }

            return null;
        } catch {
            return null;
        }
    }

    async clickNextPageButton() {
        try {
            return await this.page.evaluate(() => {
                const isDisabled = element => {
                    if (!element) return true;
                    if (element.hasAttribute('disabled')) return true;
                    const ariaDisabled = (element.getAttribute('aria-disabled') || '').toLowerCase();
                    if (ariaDisabled === 'true') return true;
                    const className = (element.className || '').toString().toLowerCase();
                    return className.includes('disabled') || className.includes('is-disabled');
                };

                const selectors = [
                    'a[rel=\"next\"]',
                    'button[aria-label*=\"следующ\" i]',
                    'a[aria-label*=\"следующ\" i]',
                    '[data-name*=\"Pagination\" i][data-name*=\"next\" i]',
                    'a[class*=\"_pagination\"]',
                    'button[class*=\"_pagination\"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null && !isDisabled(element)) {
                        element.scrollIntoView({ block: 'center', behavior: 'instant' });
                        element.click();
                        return true;
                    }
                }

                const textCandidate = Array.from(document.querySelectorAll('a, button')).find(el => {
                    if (!el || el.offsetParent === null) return false;
                    const text = (el.textContent || '').toLowerCase();
                    if (!text) return false;
                    if (!text.includes('следующ') && !text.includes('далее') && !text.includes('next')) return false;
                    return !isDisabled(el);
                });

                if (textCandidate) {
                    textCandidate.scrollIntoView({ block: 'center', behavior: 'instant' });
                    textCandidate.click();
                    return true;
                }

                return false;
            });
        } catch (error) {
            this.log(`Ошибка при попытке кликнуть по кнопке следующей страницы: ${error.message}`, 'warning');
            return false;
        }
    }

}

module.exports = CianMailer;


