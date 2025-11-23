/**
 * CIAN Mailer Bot - Автоматизация браузера для рассылки на CIAN
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const DEFAULT_CAPTCHA_API_KEY = '1bb4e1812a46fe5f41fe49d0b3ea94a7';
const fetch = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

// Применяем stealth плагин для обхода детектирования автоматизации
puppeteer.use(StealthPlugin());

class CianMailer {
    constructor(config = {}) {
        this.phone = config.phone;
        const maxPagesInput = config.maxPages ?? null;
        const parsedMaxPages = Number(maxPagesInput);
        this.maxPages = Number.isFinite(parsedMaxPages) && parsedMaxPages > 0 ? parsedMaxPages : null;
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

        const providedCaptchaKey = Object.prototype.hasOwnProperty.call(config, 'captchaApiKey') ? config.captchaApiKey : undefined;
        const resolvedCaptchaKey = providedCaptchaKey !== undefined ? providedCaptchaKey : (process.env.CAPTCHA_API_KEY || DEFAULT_CAPTCHA_API_KEY);
        this.captchaApiKey = resolvedCaptchaKey || null;

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
                : 1000,
            profileDir: config.rektCaptchaProfileDir
                ? path.resolve(config.rektCaptchaProfileDir)
                : path.resolve(__dirname, 'chrome_profile_rektcaptcha'),
            extensionId: null
        };
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
            this.processedIds = new Set(data.split('\n').filter(id => id.trim()));
            this.log(`Загружено ${this.processedIds.size} обработанных объявлений`);
        } catch (error) {
            this.log('Файл прогресса не найден, создаю новый', 'warning');
            this.processedIds = new Set();
        }
    }

    async saveProcessedId(adId) {
        if (this.alwaysProcess) return;
        await fs.appendFile(this.processedFile, `${adId}\n`);
        this.processedIds.add(adId);
    }

    isProcessed(adId) {
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
                if (fsSync.existsSync(this.rektCaptcha.extensionPath)) {
                    extensionPathToUse = this.rektCaptcha.extensionPath;
                    try {
                        fsSync.mkdirSync(this.rektCaptcha.profileDir, { recursive: true });
                    } catch (profileError) {
                        this.log(`Ошибка создания каталога профиля Chrome: ${profileError.message}`, 'warning');
                    }
                } else {
                    this.log(`Указанный путь к расширению rektCaptcha не найден: ${this.rektCaptcha.extensionPath}`, 'warning');
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
                '--lang=ru-RU,ru',
                '--window-size=2560,1440',
                '--window-position=0,0',
                '--start-maximized'
            ];

            if (extensionPathToUse) {
                launchArgs.push(`--disable-extensions-except=${extensionPathToUse}`);
                launchArgs.push(`--load-extension=${extensionPathToUse}`);
            }

            const launchOptions = {
                headless: false,
                executablePath: browserPath,
                args: launchArgs
            };

            if (extensionPathToUse) {
                launchOptions.userDataDir = this.rektCaptcha.profileDir;
            }

            this.browser = await puppeteer.launch(launchOptions);

            this.page = await this.browser.newPage();
            
            // Устанавливаем размер окна как на большом мониторе (2560x1440 - QHD)
            // await this.page.setViewport({
            //     width: 2560,
            //     height: 1440
            // }); 
            
            // Устанавливаем масштаб страницы (zoom) - 75% (как будто пользователь нажал Ctrl"-")
            await this.page.evaluate(() => {
                document.body.style.zoom = '0.6'; // 75% от обычного размера
            });
            
            // Скрываем факт автоматизации
            await this.page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
                
                // Устанавливаем zoom для всех страниц
                document.addEventListener('DOMContentLoaded', () => {
                    document.body.style.zoom = '0.75';
                });
            });

            this.log('Браузер успешно запущен', 'success');

            if (extensionPathToUse && this.rektCaptcha.autoConfigure) {
                await this.configureRektCaptchaExtension();
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
                this.log('Не удалось определить ID расширения rektCaptcha', 'warning');
                return false;
            }

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
                        const isOn = el.classList.contains('on');
                        if (shouldBeOn && !isOn) {
                            el.click();
                        }
                        if (!shouldBeOn && isOn) {
                            el.click();
                        }
                        return true;
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

                    return {
                        autoOpenApplied: ensureToggle('.settings_toggle[data-settings="recaptcha_auto_open"]', settings.autoOpen),
                        autoSolveApplied: ensureToggle('.settings_toggle[data-settings="recaptcha_auto_solve"]', settings.autoSolve),
                        clickDelayApplied: ensureInput('input[data-settings="recaptcha_click_delay_time"]', settings.clickDelay),
                        solveDelayApplied: ensureInput('input[data-settings="recaptcha_solve_delay_time"]', settings.solveDelay)
                    };
                }, settingsPayload);

                await extensionPage.waitForTimeout(400);

                const issues = [];
                if (!result.autoOpenApplied) issues.push('auto-open');
                if (!result.autoSolveApplied) issues.push('auto-solve');
                if (!result.clickDelayApplied) issues.push('click delay');
                if (!result.solveDelayApplied) issues.push('solve delay');

                if (issues.length) {
                    this.log(`Не удалось настроить элементы rektCaptcha: ${issues.join(', ')}`, 'warning');
                } else {
                    this.log('Настройки rektCaptcha обновлены', 'success');
                }

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
            
            // Устанавливаем zoom на странице
            await this.page.evaluate(() => {
                document.body.style.zoom = '0.75';
            });
            
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
                // Ждем появления поля телефона ВНУТРИ модального окна
                const phoneInput = await this.page.evaluateHandle(() => {
                    const modal = document.querySelector('[role="dialog"]') || 
                                 document.querySelector('.modal') || 
                                 document.querySelector('[class*="Modal"]');
                    
                    if (!modal) return null;
                    
                    // Ищем поле телефона ВНУТРИ модального окна
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
                    
                    // Ищем поле для кода (обычно это input[type="text"] с placeholder про код)
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

            // Проверяем есть ли финальная кнопка подтверждения (обычно авторизация происходит автоматически)
            this.log('🔘 Проверяю наличие финальной кнопки подтверждения...');
            
            await this.delay(2, 3); // Даем время на автоматическую авторизацию
            
            // Делаем скриншот
            await this.page.screenshot({ path: 'before_final_submit.png' });
            this.log('📸 Скриншот: before_final_submit.png');
            
            const clickedFinalSubmit = await this.page.evaluate(() => {
                const modal = document.querySelector('[role="dialog"]') || 
                             document.querySelector('.modal') || 
                             document.querySelector('[class*="Modal"]');
                             
                if (modal) {
                    const buttons = Array.from(modal.querySelectorAll('button'));
                    
                    const submitBtn = buttons.find(btn => 
                        btn.textContent.includes('Продолжить') || 
                        btn.textContent.includes('Войти') ||
                        btn.textContent.includes('Подтвердить') ||
                        btn.type === 'submit'
                    );
                    
                    if (submitBtn) {
                        submitBtn.click();
                        return true;
                    }
                }
                return false;
            });
            
            if (!clickedFinalSubmit) {
                this.log('ℹ️  Финальная кнопка не найдена - возможно авторизация произошла автоматически', 'warning');
            } else {
                this.log('✅ Финальная кнопка нажата!');
            }
            
            this.log('⏳ Жду закрытия модального окна и завершения авторизации...');
            
            // Ждем закрытия модального окна (до 30 секунд)
            // ВАЖНО: Если произойдет навигация (редирект) - это ХОРОШО, значит авторизация успешна!
            let modalClosed = false;
            let navigationOccurred = false;
            
            try {
                for (let attempt = 0; attempt < 30; attempt++) {
                    await this.delay(1, 1);
                    
                    try {
                        modalClosed = await this.page.evaluate(() => {
                            const modal = document.querySelector('[role="dialog"]') || 
                                         document.querySelector('.modal') || 
                                         document.querySelector('[class*="Modal"]');
                            
                            if (!modal) return true; // Модалки нет - хорошо
                            
                            // Проверяем что модалка скрыта
                            const isHidden = modal.style.display === 'none' || 
                                            modal.style.visibility === 'hidden' ||
                                            modal.getAttribute('aria-hidden') === 'true' ||
                                            !modal.offsetParent;
                            
                            return isHidden;
                        });
                        
                        if (modalClosed) {
                            this.log(`✅ Модальное окно закрылось через ${attempt + 1} секунд`);
                            break;
                        }
                        
                        // Каждые 5 секунд делаем отчет
                        if (attempt % 5 === 0 && attempt > 0) {
                            this.log(`⏳ Жду... (${attempt} сек)`);
                        }
                    } catch (evalError) {
                        // Если "Execution context was destroyed" - значит произошла навигация
                        if (evalError.message.includes('Execution context was destroyed') || 
                            evalError.message.includes('navigation')) {
                            this.log('✅ Произошла навигация страницы - авторизация успешна!', 'success');
                            navigationOccurred = true;
                            modalClosed = true;
                            break;
                        }
                        // Другие ошибки - пробрасываем
                        throw evalError;
                    }
                }
                
                if (!modalClosed && !navigationOccurred) {
                    this.log('⚠️ Модальное окно не закрылось за 30 секунд, но продолжаю...', 'warning');
                    await this.page.screenshot({ path: 'modal_not_closed_30sec.png' });
                }
                
            } catch (error) {
                // Если произошла навигация - это нормально!
                if (error.message.includes('Execution context was destroyed') || 
                    error.message.includes('navigation')) {
                    this.log('✅ Произошла навигация после авторизации - это нормально!', 'success');
                    navigationOccurred = true;
                } else {
                    this.log(`⚠️ Ошибка при проверке модального окна: ${error.message}`, 'warning');
                }
            }
            
            // Дополнительная пауза после закрытия
            await this.delay(3, 5);

            // ФИНАЛЬНАЯ ПРОВЕРКА АВТОРИЗАЦИИ
            this.log('\n🔍 НАЧИНАЮ ПРОВЕРКУ АВТОРИЗАЦИИ...');
            
            // Если произошла навигация - значит авторизация 100% успешна!
            if (navigationOccurred) {
                this.log('✅ Навигация после авторизации подтверждена');
                this.log('✅ АВТОРИЗАЦИЯ УСПЕШНА!', 'success');
                
                try {
                    await this.page.screenshot({ path: 'auth_success.png' });
                    this.log('📸 Скриншот: auth_success.png');
                } catch (e) {
                    // Игнорируем ошибки скриншота
                }
                
                return true;
            }
            
            // Если навигации не было - проверяем URL
            await this.delay(2, 3); // Даем время на полную загрузку
            
            try {
                const currentUrl = this.page.url();
                this.log(`📋 Текущий URL: ${currentUrl}`);
                
                if (currentUrl.includes('auth') || currentUrl.includes('login')) {
                    this.log('❌ Остались на странице входа - авторизация не удалась', 'error');
                    await this.page.screenshot({ path: 'auth_failed_still_on_login.png' });
                    throw new Error('Ошибка авторизации - остались на странице входа');
                }
                
                this.log('✅ URL в порядке - НЕ на странице входа');
                this.log('✅ Модальное окно закрылось');
                this.log('\n✅ АВТОРИЗАЦИЯ УСПЕШНА!', 'success');
                
                // Сохраняем скриншот успешной авторизации
                await this.page.screenshot({ path: 'auth_success.png' });
                this.log('📸 Скриншот: auth_success.png');
                
                return true;
                
            } catch (error) {
                // Если произошла ошибка при проверке URL - возможно снова навигация
                if (error.message.includes('Execution context was destroyed') || 
                    error.message.includes('navigation')) {
                    this.log('✅ Навигация подтверждена - авторизация успешна!', 'success');
                    return true;
                }
                // Пробрасываем другие ошибки
                throw error;
            }
        } catch (error) {
            this.log(`Ошибка авторизации: ${error.message}`, 'error');
            return false;
        }
    }

    async applyFiltersViaUI() {
        try {
            this.log('🔧 Применение фильтров через UI...');

            // Устанавливаем zoom на странице
            await this.page.evaluate(() => {
                document.body.style.zoom = '0.75';
            });

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
                const cards = document.querySelectorAll('[data-name="CardComponent"], .card, [data-testid*="offer-card"], article');
                console.log(`🔍 Найдено ${cards.length} карточек на странице`);
                const buttons = [];

                cards.forEach((card, index) => {
                    try {
                        // Получаем ID и URL
                        const link = card.querySelector('a[href*="/sale/flat/"]');
                        const adUrl = link ? link.href : '';
                        const adId = adUrl ? adUrl.split('/').filter(x => x).pop() : `temp_${index}`;

                        // Получаем адрес
                        const geoLabels = card.querySelectorAll('[data-name="GeoLabel"]');
                        let address = 'Не указано';
                        if (geoLabels.length > 0) {
                            const parts = Array.from(geoLabels)
                                .map(el => el.textContent.trim())
                                .filter(text => text);
                            address = parts.slice(0, 3).join(', ');
                        }
                        
                        // Если адрес не найден - пробуем альтернативные способы
                        if (address === 'Не указано') {
                            const addressSpan = card.querySelector('[class*="geo"]');
                            if (addressSpan) address = addressSpan.textContent.trim();
                        }

                        // Получаем цену
                        let price = 'Не указано';
                        const priceEl = card.querySelector('[data-mark="MainPrice"]') || 
                                       card.querySelector('[class*="price"]');
                        if (priceEl) {
                            price = priceEl.textContent.trim();
                        }

                        // Находим кнопку "Написать" - ищем ВСЕ кнопки
                        const allButtons = Array.from(card.querySelectorAll('button'));
                        const writeButton = allButtons.find(btn => {
                            const text = btn.textContent.toLowerCase();
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
                                buttonText: writeButton.textContent.trim()
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

    async waitRecaptchaSolved() {
        this.log("⏳ Жду прохождения reCAPTCHA...");
    
        try {
            // Находим iframe с капчей
            const iframeHandle = await this.page.waitForSelector(
                'iframe[src*="recaptcha"]',
                { timeout: 20000 }
            );
    
            const frame = await iframeHandle.contentFrame();
            if (!frame) {
                this.log("❌ Не удалось получить frame reCAPTCHA", 'error');
                return false;
            }
    
            // Ждем появления чекбокса
            await frame.waitForSelector('.recaptcha-checkbox-checkmark', {
                visible: true,
                timeout: 20000
            });
    
            // Ожидаем, что чекбокс станет "пройден"
            await frame.waitForFunction(() => {
                const box = document.querySelector('.recaptcha-checkbox-checkmark');
                const container = document.querySelector('.recaptcha-checkbox');
                return (
                    (box && box.offsetParent !== null) ||
                    (container && container.classList.contains('recaptcha-checkbox-checked'))
                );
            }, { timeout: 20000 });
    
            this.log("✅ reCAPTCHA пройдена!");
            return true;
    
        } catch (err) {
            this.log("❌ Ошибка ожидания reCAPTCHA: " + err.message, 'error');
            return false;
        }
    }
    

    async solveCaptcha({ frame, sitekey, pageUrl, isInvisible = false }) {
        if (!this.captchaApiKey) {
            this.log('CAPTCHA_API_KEY не задан, пропускаю решение капчи', 'warning');
            return false;
        }

        if (!sitekey) {
            this.log('Не указан sitekey для решения reCAPTCHA', 'error');
            return false;
        }

        try {
            this.log('🧩 Отправляю капчу в 2Captcha...');

            const payload = new URLSearchParams({
                key: this.captchaApiKey,
                method: 'userrecaptcha',
                googlekey: sitekey,
                pageurl: pageUrl,
                json: '1'
            });

            if (isInvisible) {
                payload.append('invisible', '1');
            }

            const response = await fetch('http://2captcha.com/in.php', {
                method: 'POST',
                body: payload
            });
            const result = await response.json();

            if (result.status !== 1) {
                this.log(`Ошибка отправки капчи: ${JSON.stringify(result)}`, 'error');
                return false;
            }

            const captchaId = result.request;
            for (let attempt = 0; attempt < 8; attempt++) {
                await this.delay(12, 12);
                const statusResponse = await fetch(`http://2captcha.com/res.php?key=${this.captchaApiKey}&action=get&id=${captchaId}&json=1`);
                const statusResult = await statusResponse.json();

                if (statusResult.status === 1) {
                    const token = statusResult.request;
                    const targetFrame = frame || this.page.mainFrame();
                    const injected = await targetFrame.evaluate((tokenValue, invisibleMode) => {
                        const ensureFields = () => {
                            const fields = new Set();
                            const createField = () => {
                                const textarea = document.createElement('textarea');
                                textarea.id = 'g-recaptcha-response';
                                textarea.name = 'g-recaptcha-response';
                                textarea.style.display = 'none';
                                document.body.appendChild(textarea);
                                return textarea;
                            };

                            const candidates = Array.from(document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[id="g-recaptcha-response"], input[name="g-recaptcha-response"], input[id="g-recaptcha-response"]'));
                            if (candidates.length === 0) {
                                candidates.push(createField());
                            }

                            candidates.forEach(el => fields.add(el));
                            return Array.from(fields);
                        };

                        const applyValue = element => {
                            if (!element) return;
                            if ('value' in element) {
                                element.value = tokenValue;
                            } else {
                                element.textContent = tokenValue;
                            }

                            const inputEvent = typeof InputEvent === 'function'
                                ? new InputEvent('input', { bubbles: true })
                                : new Event('input', { bubbles: true });
                            element.dispatchEvent(inputEvent);
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                        };

                        const triggerCallbacks = () => {
                            let triggered = false;
                            const cfg = window.___grecaptcha_cfg;
                            if (!cfg || !cfg.clients) {
                                return triggered;
                            }

                            const visited = new WeakSet();
                            const callbacks = new Set();
                            const enqueue = target => {
                                if (!target || typeof target !== 'object') return;
                                if (visited.has(target)) return;
                                visited.add(target);
                                Object.entries(target).forEach(([key, value]) => {
                                    if (!value) return;
                                    if (key === 'callback' && typeof value === 'function') {
                                        callbacks.add(value);
                                    } else if (typeof value === 'object') {
                                        enqueue(value);
                                    }
                                });
                            };

                            Object.values(cfg.clients).forEach(enqueue);

                            callbacks.forEach(fn => {
                                try {
                                    fn(tokenValue);
                                    triggered = true;
                                } catch (error) {
                                    console.error('Ошибка вызова callback reCAPTCHA:', error);
                                }
                            });

                            return triggered;
                        };

                        const submitForms = () => {
                            const forms = new Set();
                            document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[id="g-recaptcha-response"], input[name="g-recaptcha-response"], input[id="g-recaptcha-response"]').forEach(field => {
                                if (field.form) {
                                    forms.add(field.form);
                                }
                            });

                            forms.forEach(form => {
                                try {
                                    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                                    form.dispatchEvent(submitEvent);
                                    if (!submitEvent.defaultPrevented && typeof form.submit === 'function') {
                                        form.submit();
                                    }
                                } catch (error) {
                                    console.error('Ошибка при отправке формы после reCAPTCHA:', error);
                                }
                            });
                        };

                        const fields = ensureFields();
                        fields.forEach(applyValue);

                        if (typeof window.grecaptcha === 'object' && typeof window.grecaptcha.getResponse === 'function') {
                            try {
                                window.grecaptcha.getResponse();
                            } catch (error) {
                                console.warn('Ошибка grecaptcha.getResponse:', error);
                            }
                        }

                        const callbacksTriggered = triggerCallbacks();

                        if (invisibleMode) {
                            submitForms();
                        } else if (!callbacksTriggered) {
                            submitForms();
                        }

                        return { fieldsCount: fields.length, callbacksTriggered };
                    }, token, isInvisible);

                    this.log(`✅ Капча решена и токен вставлен (полей: ${injected?.fieldsCount || 0}, callbacks: ${injected?.callbacksTriggered ? 'да' : 'нет'})`, 'success');
                    return true;
                }

                if (statusResult.request !== 'CAPCHA_NOT_READY') {
                    this.log(`Ошибка решения капчи: ${JSON.stringify(statusResult)}`, 'error');
                    return false;
                }
            }

            this.log('⏱️ Превышено время ожидания решения капчи', 'error');
            return false;
        } catch (error) {
            this.log(`Ошибка во время решения капчи: ${error.message}`, 'error');
            return false;
        }
    }

    async clickSendButton(frame) {
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
                return false;
            }

            this.log('📨 Нажал кнопку "Отправить"', 'success');
            await this.delay(5, 8);

            return true;
        } catch (error) {
            this.log(`❌ Ошибка при нажатии кнопки "Отправить": ${error.message}`, 'error');
            return false;
        }
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

                    const recaptchaStatus = await this.solveRecaptchaIfPresent(frame);
                    if (recaptchaStatus.found) {
                        if (recaptchaStatus.solved) {
                            this.log('🔁 Повторно отправляю сообщение после решения reCAPTCHA');
                            await this.delay(2, 3);
                            const resendAfterCaptcha = await this.clickSendButton(frame);
                            if (!resendAfterCaptcha) {
                                this.log('⚠️ Не удалось повторно отправить сообщение после решения reCAPTCHA', 'warning');
                            }
                        } else {
                            this.log('❌ Не удалось решить reCAPTCHA — пропускаю объявление', 'error');
                            continue;
                        }
                    }

                    // Сохраняем скриншот IFRAME (а не всей страницы!)
                    try {
                        // Делаем скриншот именно frame, а не всей страницы
                        const frameElement = await this.page.$('iframe[data-testid="ChatModal"], iframe');
                        if (frameElement) {
                            await frameElement.screenshot({ path: `message_input_${btnData.adId}.png` });
                            this.log(`Скриншот iframe: message_input_${btnData.adId}.png`);
                        }
                    } catch (e) {
                        // Если не получилось - сохраняем всю страницу
                        await this.page.screenshot({ path: `message_input_${btnData.adId}.png` });
                        this.log(`Скриншот страницы: message_input_${btnData.adId}.png`);
                    }

                    this.log('⏸️  Пауза 10 сек — проверь визуально текст в чате');
                    await this.delay(15, 15);
                    this.log('✉️  Повторно нажимаю "Отправить" для надёжности');
                    await this.clickSendButton(frame);

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
                    this.log('Перехожу к следующему объявлению (iframe остаётся открытым)...');
                    
                    processed++;

                    // Минимальная пауза между объявлениями (для стабильности)
                    if (i < buttonsToProcess.length - 1) {
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
            const baseUrl = 'https://www.cian.ru/cat.php?deal_type=sale&offer_type=flat&region=1';
            this.log(`🌐 Открываю страницу поиска...`);
            await this.page.goto(baseUrl, { waitUntil: 'networkidle2' });
            await this.delay(3, 5);

            // Применяем фильтры
            if (!await this.applyFiltersViaUI()) {
                throw new Error('Не удалось применить фильтры');
            }

            await this.delay(5, 8);

            // Обрабатываем страницы
            let totalProcessed = 0;
            let page = 1;

            while (true) {
                if (page > 1) {
                    const navigated = await this.navigateToResultsPage(page);
                    if (!navigated) {
                        this.log('⚠️ Не удалось перейти на следующую страницу, завершаю обход.', 'warning');
                        break;
                    }
                }

                const processed = await this.processPage(page);
                totalProcessed += processed;

                this.log(`\n✅ Страница ${page} завершена: обработано ${processed} объявлений`);
                this.log(`📊 Всего обработано: ${totalProcessed}`);

                const limitReached = this.maxPages !== null && page >= this.maxPages;
                const hasNext = await this.hasNextResultsPage();

                if (limitReached) {
                    this.log(`⚠️ Достигнут предел maxPages (${this.maxPages}). Останавливаю переход по страницам.`, 'warning');
                    break;
                }

                if (!hasNext) {
                    this.log('✅ Следующая страница не найдена — достигнут конец выдачи.', 'success');
                    break;
                }

                const pause = Math.random() * (10 - 5) + 5;
                this.log(`⏸️ Пауза ${pause.toFixed(1)} сек перед следующей страницей...`);
                await this.delay(pause, pause);

                page += 1;
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
        }
    }

    async solveRecaptchaIfPresent(formFrame) {
        if (!this.captchaApiKey) {
            return { found: false, solved: false };
        }

        const resultTemplate = (found, solved) => ({ found, solved });

        try {
            const challengeIframeHandle = await this.page.$('iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]');
            const challengeFrame = challengeIframeHandle ? await challengeIframeHandle.contentFrame() : null;

            const info = await this.detectRecaptchaInfo(formFrame, challengeFrame);
            if (!info || !info.sitekey) {
                if (challengeIframeHandle) {
                    this.log('❌ Обнаружен iframe reCAPTCHA, но не удалось определить sitekey', 'error');
                    return resultTemplate(true, false);
                }
                return resultTemplate(false, false);
            }

            this.log(`🔐 Обнаружена reCAPTCHA (sitekey=${info.sitekey}${info.isInvisible ? ', invisible' : ''})`);

            const solved = await this.solveCaptcha({
                frame: formFrame || challengeFrame || this.page.mainFrame(),
                sitekey: info.sitekey,
                pageUrl: this.page.url(),
                isInvisible: info.isInvisible
            });

            if (!solved) {
                this.log('❌ Не удалось решить reCAPTCHA через 2Captcha', 'error');
                return resultTemplate(true, false);
            }

            await this.waitForRecaptchaToDisappear();
            return resultTemplate(true, true);
        } catch (error) {
            this.log(`Ошибка обработки reCAPTCHA: ${error.message}`, 'error');
            return resultTemplate(true, false);
        }
    }

    async waitForRecaptchaToDisappear(timeoutMs = 20000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const handle = await this.page.$('iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]');
            if (!handle) {
                this.log('✅ reCAPTCHA iframe исчез', 'success');
                return true;
            }
            await this.delay(1, 1);
        }
        this.log('⚠️ reCAPTCHA iframe не исчез вовремя', 'warning');
        return false;
    }

    async hasNextResultsPage() {
        try {
            return await this.page.evaluate(() => {
                const isEnabled = element => {
                    if (!element) return false;
                    if (element.hasAttribute('disabled')) return false;
                    if ((element.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
                    const className = (element.className || '').toString().toLowerCase();
                    if (className.includes('disabled') || className.includes('is-disabled') || className.includes('pagination__arrow--disabled')) {
                        return false;
                    }
                    return true;
                };

                const matchesNext = element => {
                    if (!element) return false;
                    const rel = (element.getAttribute('rel') || '').toLowerCase();
                    if (rel === 'next') return true;

                    const aria = (element.getAttribute('aria-label') || '').toLowerCase();
                    if (aria.includes('следующ')) return true;

                    const dataName = (element.getAttribute('data-name') || '').toLowerCase();
                    if (dataName.includes('pagination') && dataName.includes('next')) return true;

                    const text = (element.textContent || '').toLowerCase();
                    if (text.includes('следующ')) return true;

                    return false;
                };

                const candidates = Array.from(document.querySelectorAll('a, button'))
                    .filter(el => matchesNext(el));

                return candidates.some(el => isEnabled(el));
            });
        } catch (error) {
            this.log(`Ошибка проверки следующей страницы: ${error.message}`, 'warning');
            return false;
        }
    }

    async navigateToResultsPage(pageNumber) {
        try {
            const currentUrl = this.page.url();
            const pagePattern = /([?&]p=)\d+/;
            let newUrl;

            if (pagePattern.test(currentUrl)) {
                newUrl = currentUrl.replace(pagePattern, `$1${pageNumber}`);
            } else {
                const separator = currentUrl.includes('?') ? '&' : '?';
                newUrl = `${currentUrl}${separator}p=${pageNumber}`;
            }

            this.log(`🌐 Переход на страницу ${pageNumber}...`);
            await this.page.goto(newUrl, { waitUntil: 'networkidle2' });
            await this.delay(3, 5);
            return true;
        } catch (error) {
            this.log(`Ошибка перехода на страницу ${pageNumber}: ${error.message}`, 'error');
            return false;
        }
    }

    async detectRecaptchaInfo(formFrame, challengeFrame) {
        const collectInfoFn = () => {
            const result = {
                sitekey: null,
                isInvisible: false,
                found: false
            };

            const toLowerString = value => {
                if (typeof value === 'string') return value.toLowerCase();
                if (value === null || value === undefined) return '';
                try {
                    return String(value).toLowerCase();
                } catch (error) {
                    return '';
                }
            };

            const setSitekey = value => {
                if (result.sitekey) return;
                if (typeof value === 'string' && value.trim().length > 0) {
                    result.sitekey = value.trim();
                    result.found = true;
                }
            };

            const markInvisible = () => {
                result.isInvisible = true;
                result.found = true;
            };

            const inspectElement = el => {
                if (!el) return;
                const key = el.getAttribute('data-sitekey') || el.dataset?.sitekey;
                if (key) setSitekey(key);
                const sizeAttr = el.getAttribute('data-size') || el.dataset?.size;
                if (toLowerString(sizeAttr) === 'invisible') {
                    markInvisible();
                }
            };

            document.querySelectorAll('[data-sitekey]').forEach(inspectElement);

            const inspectRecaptchaConfig = source => {
                if (!source || typeof source !== 'object') return;
                const visited = new WeakSet();
                const queue = [source];

                while (queue.length) {
                    const current = queue.shift();
                    if (!current || typeof current !== 'object') continue;
                    if (visited.has(current)) continue;
                    visited.add(current);

                    const directKey = current.sitekey || current.k || current.client?.sitekey;
                    const paramsKey = current.params && (current.params.sitekey || current.params.k);
                    setSitekey(directKey || paramsKey);

                    const sizeValue = toLowerString(current.size || current.params?.size);
                    if (sizeValue === 'invisible') {
                        markInvisible();
                    }

                    Object.values(current).forEach(value => {
                        if (!value) return;
                        if (typeof value === 'function') return;
                        if (typeof value === 'object') {
                            queue.push(value);
                        }
                    });
                }
            };

            if (typeof window.___grecaptcha_cfg === 'object' && window.___grecaptcha_cfg.clients) {
                Object.values(window.___grecaptcha_cfg.clients).forEach(client => inspectRecaptchaConfig(client));
            }

            document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]').forEach(frame => {
                const src = frame.getAttribute('src') || '';
                const match = src.match(/[?&]k=([^&]+)/);
                if (match) {
                    try {
                        setSitekey(decodeURIComponent(match[1]));
                    } catch (e) {
                        setSitekey(match[1]);
                    }
                }
                const sizeMatch = src.match(/[?&]size=([^&]+)/);
                if (sizeMatch && toLowerString(sizeMatch[1]) === 'invisible') {
                    markInvisible();
                }
            });

            return result;
        };

        const mergeInfo = (target, source) => {
            if (!source) return target;
            const merged = { ...target };
            if (!merged.sitekey && source.sitekey) {
                merged.sitekey = source.sitekey;
            }
            if (source.isInvisible) {
                merged.isInvisible = true;
            }
            if (source.found) {
                merged.found = true;
            }
            return merged;
        };

        let aggregated = { sitekey: null, isInvisible: false, found: false };

        const contexts = [formFrame, challengeFrame, this.page];
        for (const context of contexts) {
            if (!context) continue;
            try {
                const info = await context.evaluate(collectInfoFn);
                aggregated = mergeInfo(aggregated, info);
            } catch (error) {
                this.log(`⚠️ Не удалось извлечь данные reCAPTCHA: ${error.message}`, 'warning');
            }
        }

        return aggregated;
    }
}

module.exports = CianMailer;

