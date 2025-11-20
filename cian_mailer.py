#!/usr/bin/env python3
"""
CIAN Mailing Automation Script
Автоматизация легальной рассылки по партнерским объявлениям на CIAN
"""

import os
import time
import csv
import logging
import random
from datetime import datetime
from typing import List, Dict, Optional

import requests
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
from dotenv import load_dotenv

# Попытка импорта undetected_chromedriver (опционально)
try:
    import undetected_chromedriver as uc
    UC_AVAILABLE = True
except:
    UC_AVAILABLE = False


class CianMailingBot:
    """Класс для автоматизации рассылки сообщений на CIAN"""

    def __init__(self):
        # Загрузка конфигурации
        load_dotenv('config.env')

        self.email = os.getenv('CIAN_EMAIL')
        self.password = os.getenv('CIAN_PASSWORD')
        self.captcha_api_key = os.getenv('CAPTCHA_API_KEY')
        self.message_delay = int(os.getenv('MESSAGE_DELAY', 5))
        self.max_retries = int(os.getenv('MAX_RETRIES', 3))
        self.csv_filename = os.getenv('CSV_FILENAME', 'cian_mailing_stats.csv')

        # Настройка логирования
        self.setup_logging()

        # Статистика
        self.stats = {
            'total_processed': 0,
            'messages_sent': 0,
            'captcha_solved': 0,
            'errors': 0,
            'start_time': datetime.now()
        }

        # Инициализация драйвера
        self.driver = None

    def setup_logging(self):
        """Настройка системы логирования"""
        # Настройка вывода в консоль с UTF-8
        import sys
        if sys.platform == 'win32':
            # Windows: устанавливаем UTF-8 для консоли
            try:
                sys.stdout.reconfigure(encoding='utf-8')
            except:
                pass
        
        logging.basicConfig(
            filename='cian_mailer.log',
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            encoding='utf-8'
        )
        self.logger = logging.getLogger(__name__)

    def init_driver(self):
        """Инициализация Chrome WebDriver"""
        try:
            print("   🔧 Настройка Chrome опций...")
            
            # Используем обычный Selenium с webdriver-manager
            chrome_options = Options()
            chrome_options.add_argument("--start-maximized")
            chrome_options.add_argument("--disable-blink-features=AutomationControlled")
            chrome_options.add_experimental_option("excludeSwitches", ["enable-logging"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            # ВАЖНО: Временный профиль (чистые фильтры CIAN, без сохраненных настроек)
            import tempfile
            temp_profile = tempfile.mkdtemp()
            chrome_options.add_argument(f"--user-data-dir={temp_profile}")
            self.logger.info(f"Используем временный профиль: {temp_profile}")
            
            print("   🚀 Запуск Chrome (антидетект режим)...")
            print("   ⏳ Это может занять 10-30 секунд при первом запуске...")
            
            # Используем undetected_chromedriver для обхода детекта
            try:
                # Создаём НОВЫЕ опции без конфликтных параметров для undetected_chromedriver
                uc_options = uc.ChromeOptions()
                uc_options.add_argument("--start-maximized")
                uc_options.add_argument("--disable-blink-features=AutomationControlled")
                uc_options.add_argument(f"--user-data-dir={temp_profile}")
                
                self.driver = uc.Chrome(options=uc_options, version_main=None, use_subprocess=True)
                print("   ✅ Используется undetected_chromedriver (антидетект)")
            except Exception as e:
                print(f"   ⚠️  undetected_chromedriver недоступен: {e}")
                print("   🔄 Использую стандартный Chrome...")
                service = ChromeService(ChromeDriverManager().install())
                self.driver = webdriver.Chrome(service=service, options=chrome_options)
                
                # Скрываем факт автоматизации
                self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                    "source": """
                        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                        Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                        Object.defineProperty(navigator, 'languages', {get: () => ['ru-RU', 'ru', 'en-US', 'en']});
                    """
                })

            self.logger.info("Chrome WebDriver успешно инициализирован")
            print("   ✅ Драйвер успешно запущен!")
            return True

        except Exception as e:
            self.logger.error(f"Ошибка инициализации WebDriver: {e}")
            print(f"   ❌ ОШИБКА: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def clear_cian_cookies(self):
        """Очистка cookies CIAN для сброса фильтров"""
        try:
            self.driver.get("https://cian.ru/")
            time.sleep(2)
            self.driver.delete_all_cookies()
            self.logger.info("Cookies CIAN очищены")
            return True
        except Exception as e:
            self.logger.error(f"Ошибка очистки cookies: {e}")
            return False
    
    def verify_url_filters(self, url: str) -> bool:
        """Проверка что URL открылся с правильными фильтрами"""
        try:
            current_url = self.driver.current_url
            
            # Извлекаем параметры из исходного URL
            from urllib.parse import urlparse, parse_qs
            
            original_params = parse_qs(urlparse(url).query)
            current_params = parse_qs(urlparse(current_url).query)
            
            # Ключевые параметры для проверки
            key_params = ['deal_type', 'agent_type', 'object_type']
            
            mismatches = []
            for param in key_params:
                if param in original_params:
                    if param not in current_params or current_params[param] != original_params[param]:
                        mismatches.append(f"{param}: ожидалось {original_params[param]}, получено {current_params.get(param, 'НЕТ')}")
            
            if mismatches:
                self.logger.warning(f"⚠️ Фильтры изменились CIAN'ом: {', '.join(mismatches)}")
                print(f"⚠️ ВНИМАНИЕ: CIAN изменил фильтры!")
                for m in mismatches:
                    print(f"   • {m}")
                return False
            
            self.logger.info("✅ Фильтры применены корректно")
            return True
            
        except Exception as e:
            self.logger.error(f"Ошибка проверки фильтров: {e}")
            return False

    def login_to_cian(self) -> bool:
        """Авторизация в аккаунте CIAN"""
        try:
            self.logger.info("Начинаем процесс авторизации на CIAN")
            print("\n" + "="*60)
            print("🔐 АВТОМАТИЧЕСКАЯ АВТОРИЗАЦИЯ")
            print("="*60)
            
            # Открываем главную страницу
            print("🌐 Открываю https://www.cian.ru/...")
            self.driver.get("https://www.cian.ru/")
            time.sleep(random.uniform(2, 4))

            # Найти и кликнуть кнопку входа
            print("🔍 Ищу кнопку 'Войти'...")
            login_trigger = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable((
                    By.CSS_SELECTOR, 
                    "[data-name='LoginButton'], "
                    "a[href*='authenticate'], "
                    "a[href*='auth'], "
                    ".login-button, "
                    ".header-login"
                ))
            )
            print(f"✅ Найдена кнопка: {login_trigger.text or login_trigger.get_attribute('href')}")
            
            # Клик через JavaScript для надёжности
            self.driver.execute_script("arguments[0].click();", login_trigger)
            print("🖱️  Кликнул на кнопку входа")
            time.sleep(random.uniform(2, 4))

            # ШАГ 1: Ждём МОДАЛЬНОЕ ОКНО авторизации
            print("🔍 Ищу модальное окно авторизации...")
            modal_window = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((
                    By.CSS_SELECTOR,
                    "[role='dialog'], "
                    ".modal, "
                    "[class*='modal'], "
                    "[class*='Modal'], "
                    "[data-testid*='modal']"
                ))
            )
            print("✅ Найдено модальное окно")
            
            # ШАГ 2: Ищем кнопку "Другой способ" ВНУТРИ модального окна
            print("🔍 Ищу кнопку 'Другой способ' в модальном окне...")
            try:
                other_method_button = modal_window.find_element(
                    By.XPATH,
                    ".//button[contains(., 'Другой способ')] | "
                    ".//a[contains(., 'Другой способ')] | "
                    ".//span[contains(., 'Другой способ')]/.."
                )
                print("✅ Найдена кнопка 'Другой способ'")
                other_method_button.click()
                print("🖱️  Кликнул 'Другой способ'")
                time.sleep(random.uniform(2, 3))
            except NoSuchElementException:
                print("ℹ️  Кнопка 'Другой способ' не найдена (возможно, сразу форма email)")

            # ШАГ 3: Ждём и заполняем поле email ВНУТРИ модального окна
            print("🔍 Ищу поле Email в модальном окне...")
            try:
                email_input = WebDriverWait(modal_window, 15).until(
                    EC.presence_of_element_located((
                        By.CSS_SELECTOR,
                        "input[type='email'], "
                        "input[name='email'], "
                        "input[type='text'], "
                        "input[placeholder*='E-mail'], "
                        "input[placeholder*='e-mail'], "
                        "input[autocomplete='username'], "
                        "input[autocomplete='email']"
                    ))
                )
                print("✅ Найдено поле Email в модальном окне")
            except TimeoutException:
                print("❌ Поле Email не найдено в модальном окне!")
                screenshot_name = "modal_no_email.png"
                self.driver.save_screenshot(screenshot_name)
                print(f"📸 Скриншот сохранен: {screenshot_name}")
                raise
            
            # Вводим email
            print(f"📧 Ввожу email: {self.email[:3]}***{self.email[-10:]}")
            
            # Делаем поле видимым и активным
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", email_input)
            time.sleep(0.5)
            
            # Фокусируемся на поле через JS
            self.driver.execute_script("arguments[0].focus();", email_input)
            time.sleep(0.3)
            
            # Очищаем поле
            self.driver.execute_script("arguments[0].value = '';", email_input)
            time.sleep(0.2)
            
            # Вводим email ПОСИМВОЛЬНО (как человек)
            for char in self.email:
                email_input.send_keys(char)
                time.sleep(random.uniform(0.05, 0.15))
            
            time.sleep(random.uniform(0.5, 1))
            print("✅ Email введён посимвольно")

            # ШАГ 4: Нажимаем "Продолжить" ВНУТРИ модального окна
            print("🔍 Ищу кнопку 'Продолжить' в модальном окне...")
            continue_button = WebDriverWait(modal_window, 10).until(
                EC.element_to_be_clickable((
                    By.XPATH,
                    ".//button[contains(., 'Продолжить')] | "
                    ".//button[@type='submit']"
                ))
            )
            print("✅ Найдена кнопка 'Продолжить'")
            continue_button.click()
            print("🖱️  Кликнул 'Продолжить'")
            time.sleep(random.uniform(2, 4))

            # ШАГ 5: Ждём поле пароля ВНУТРИ модального окна
            print("🔍 Ищу поле пароля в модальном окне...")
            password_input = WebDriverWait(modal_window, 15).until(
                EC.presence_of_element_located((
                    By.CSS_SELECTOR,
                    "input[type='password'], "
                    "input[name='password'], "
                    "input[placeholder*='ароль']"
                ))
            )
            print("✅ Найдено поле пароля в модальном окне")

            # Вводим пароль
            print("🔒 Ввожу пароль...")
            
            # Делаем поле видимым и активным
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", password_input)
            time.sleep(0.5)
            
            # Фокусируемся на поле
            self.driver.execute_script("arguments[0].focus();", password_input)
            time.sleep(0.3)
            
            # Очищаем поле
            self.driver.execute_script("arguments[0].value = '';", password_input)
            time.sleep(0.2)
            
            # Вводим пароль ПОСИМВОЛЬНО
            for char in self.password:
                password_input.send_keys(char)
                time.sleep(random.uniform(0.05, 0.15))
            
            time.sleep(random.uniform(0.5, 1))
            print("✅ Пароль введён посимвольно")

            # ШАГ 6: Нажимаем финальную кнопку "Продолжить" (после пароля)
            print("🔍 Ищу кнопку 'Продолжить' (финальная после пароля)...")
            try:
                # Пробуем найти кнопку в обновлённом модальном окне
                modal_window_updated = self.driver.find_element(
                    By.CSS_SELECTOR,
                    "[role='dialog'], .modal, [class*='modal'], [class*='Modal']"
                )
                
                final_continue_button = WebDriverWait(modal_window_updated, 10).until(
                    EC.element_to_be_clickable((
                        By.XPATH,
                        ".//button[contains(., 'Продолжить')] | "
                        ".//button[@type='submit']"
                    ))
                )
                
                print(f"✅ Найдена кнопка: {final_continue_button.text}")
                print("🖱️  Кликаю 'Продолжить' (финальная кнопка после пароля)...")
                final_continue_button.click()
                time.sleep(random.uniform(3, 5))
                
            except TimeoutException:
                print("❌ Финальная кнопка 'Продолжить' не найдена!")
                screenshot_name = "before_final_button.png"
                self.driver.save_screenshot(screenshot_name)
                print(f"📸 Скриншот сохранен: {screenshot_name}")
                raise

            # Просто ждём немного после финальной кнопки
            print("⏳ Ожидаю завершения авторизации...")
            time.sleep(5)
            
            # Проверяем что не остались на странице авторизации
            if "auth" in self.driver.current_url.lower() or "login" in self.driver.current_url.lower():
                print("❌ Ошибка авторизации - остались на странице входа")
                print(f"📋 Текущий URL: {self.driver.current_url}")
                self.logger.error("Ошибка авторизации - остались на странице входа")
                self.stats['errors'] += 1
                return False
            
            # Если модальное окно закрылось и мы на главной - считаем успехом
            self.logger.info("Авторизация на CIAN прошла успешно")
            print("✅ УСПЕШНАЯ АВТОРИЗАЦИЯ!")
            print("="*60 + "\n")
            return True

        except Exception as e:
            self.logger.error(f"Ошибка при авторизации: {e}", exc_info=True)
            print(f"❌ КРИТИЧЕСКАЯ ОШИБКА: {e}")
            print("="*60 + "\n")
            self.stats['errors'] += 1
            return False

    def solve_captcha(self, url: str) -> Optional[str]:
        """Решение reCAPTCHA через 2Captcha API"""
        try:
            # Автоматически ищи sitekey
            try:
                sitekey = self.driver.find_element(By.CSS_SELECTOR, ".g-recaptcha, [data-sitekey]").get_attribute("data-sitekey")
            except:
                return None

            # POST на http://2captcha.com/in.php
            payload = {
                'key': self.captcha_api_key,
                'method': 'userrecaptcha',
                'googlekey': sitekey,
                'pageurl': url,
                'json': 1
            }

            response = requests.post('http://2captcha.com/in.php', data=payload)
            result = response.json()

            if result.get('status') != 1:
                self.logger.error(f"Ошибка отправки капчи: {result}")
                self.stats['errors'] += 1
                return None

            captcha_id = result.get('request')
            self.logger.info(f"Капча отправлена на решение, ID: {captcha_id}")

            # Цикл опроса каждые 12 сек до 90 сек
            for _ in range(8):  # 12*7=84 сек, +6 сек на последний = 90 сек
                time.sleep(12)

                check_payload = {
                    'key': self.captcha_api_key,
                    'action': 'get',
                    'id': captcha_id,
                    'json': 1
                }

                check_response = requests.get('http://2captcha.com/res.php', params=check_payload)
                check_result = check_response.json()

                if check_result.get('status') == 1:
                    token = check_result.get('request')
                    self.logger.info("Капча успешно решена")
                    self.driver.execute_script(f'document.getElementById("g-recaptcha-response").innerHTML = "{token}";')
                    self.driver.execute_script("document.getElementById('g-recaptcha-response').style.display = 'block';")
                    self.stats['captcha_solved'] += 1
                    return token

            self.logger.error("Превышено время ожидания капчи")
            self.stats['errors'] += 1
            return None

        except Exception as e:
            self.logger.error(f"Ошибка при решении капчи: {e}")
            self.stats['errors'] += 1
            return None

    def find_message_buttons(self) -> List[Dict]:
        """Поиск кнопок 'Написать' на странице"""
        message_buttons = []

        try:
            # Найди все карточки объявлений
            cards = self.driver.find_elements(By.CSS_SELECTOR, "[data-name='CardComponent'], .card, [data-testid*='offer-card']")

            for card in cards:
                try:
                    # Для каждой карточки
                    # Извлекаем ID и ссылку
                    ad_id = ""
                    ad_url = ""
                    try:
                        link_elem = card.find_element(By.XPATH, ".//a[contains(@href, '/sale/flat/')]")
                        ad_url = link_elem.get_attribute("href")
                        ad_id = ad_url.split("/")[-2] if ad_url else ""
                    except:
                        pass
                    
                    # Извлекаем адрес (используем GeoLabel - самый надежный селектор)
                    address = "Не указано"
                    try:
                        # Ищем элементы GeoLabel (содержат: город, округ, район)
                        geo_labels = card.find_elements(By.XPATH, ".//*[@data-name='GeoLabel']")
                        if geo_labels:
                            # Собираем текст из всех GeoLabel (Москва, ЦАО, р-н Тверской)
                            address_parts = [label.text.strip() for label in geo_labels if label.text.strip()]
                            if address_parts:
                                address = ", ".join(address_parts[:3])  # Берем первые 3 части
                        
                        # Если GeoLabel не найден - используем резервный вариант
                        if address == "Не указано":
                            address_elem = card.find_element(By.XPATH, ".//span[contains(text(), 'Москва')]")
                            address = address_elem.text.strip()
                    except:
                        pass

                    # Извлекаем цену
                    price = "Не указано"
                    try:
                        price_elem = card.find_element(By.XPATH, ".//span[@data-mark='MainPrice']")
                        price = price_elem.text.strip()
                    except:
                        try:
                            price_elem = card.find_element(By.XPATH, ".//span[contains(@class, 'price')]")
                            price = price_elem.text.strip()
                        except:
                            pass

                    # Найди кнопку "Написать" в этой карточке
                    button = None
                    try:
                        button = card.find_element(By.XPATH, ".//button[contains(., 'Написать') or contains(., 'Связаться')]")
                        if not button.is_displayed():
                            button = None
                    except:
                        pass

                    if button:
                        button_data = {
                            'button': button,
                            'address': address,
                            'price': price,
                            'ad_id': ad_id
                        }
                        message_buttons.append(button_data)

                except Exception as e:
                    self.logger.error(f"Ошибка при обработке карточки: {e}")
                    self.stats['errors'] += 1
                    continue

            self.logger.info(f"Найдено {len(message_buttons)} кнопок 'Написать'")
            return message_buttons

        except Exception as e:
            self.logger.error(f"Ошибка при поиске кнопок: {e}")
            self.stats['errors'] += 1
            return []



    def send_message(self, button_data: Dict, message: str) -> bool:
        """Отправка сообщения через кнопку"""
        try:
            button = button_data['button']
            ad_info = {
                'address': button_data.get('address', 'Не указано'),
                'price': button_data.get('price', 'Не указано'),
                'ad_id': button_data.get('ad_id', '')
            }

            # Кликни по кнопке
            button.click()

            # Дождись открытия окна чата/диалога и textarea
            message_form = WebDriverWait(self.driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "textarea, input[type='text'][placeholder*='essage'], div[contenteditable='true']"))
            )

            # Введи unique_message с рандомными задержками
            for char in message:
                message_form.send_keys(char)
                time.sleep(random.uniform(0.1, 0.3))

            time.sleep(random.uniform(1, 3))

            # ПЕРЕД нажатием "Отправить" проверяем капчу
            if self.driver.find_elements(By.CSS_SELECTOR, ".g-recaptcha, [data-sitekey]"):
                token = self.solve_captcha(self.driver.current_url)
                if not token:
                    return False
                time.sleep(random.uniform(1, 3))

            # Нажми "Отправить"
            send_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit'], button[class*='send'], button:contains('Отправить')")
            send_button.click()

            time.sleep(random.uniform(5, 10))

            self.logger.info(f"Сообщение отправлено для объявления {ad_info.get('ad_id', 'unknown')}")
            return True

        except Exception as e:
            self.logger.error(f"Ошибка отправки сообщения: {e}")
            self.stats['errors'] += 1
            return False

    def save_stats_to_csv(self):
        """Сохранение статистики в CSV"""
        try:
            file_exists = os.path.exists(self.csv_filename)

            with open(self.csv_filename, 'a', newline='', encoding='utf-8') as csvfile:
                fieldnames = ['timestamp', 'total_processed', 'messages_sent', 'captcha_solved', 'errors', 'duration_minutes']
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

                if not file_exists:
                    writer.writeheader()

                duration = (datetime.now() - self.stats['start_time']).total_seconds() / 60

                writer.writerow({
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'total_processed': self.stats['total_processed'],
                    'messages_sent': self.stats['messages_sent'],
                    'captcha_solved': self.stats['captcha_solved'],
                    'errors': self.stats['errors'],
                    'duration_minutes': round(duration, 2)
                })

            self.logger.info(f"Статистика сохранена в {self.csv_filename}")

        except Exception as e:
            self.logger.error(f"Ошибка сохранения статистики: {e}")
            self.stats['errors'] += 1

    def run_mailing(self, target_urls: List[str], message_template: str):
        """Основной метод запуска рассылки"""
        try:
            self.logger.info("Запуск процесса рассылки")

            if not self.init_driver():
                raise Exception("Не удалось инициализировать WebDriver")

            if not self.login_to_cian():
                raise Exception("Не удалось авторизоваться на CIAN")

            for url in target_urls:
                try:
                    self.logger.info(f"Обработка URL: {url}")
                    
                    # Очищаем cookies перед переходом на новый URL (сброс фильтров)
                    self.clear_cian_cookies()
                    time.sleep(2)
                    
                    self.driver.get(url)
                    time.sleep(random.uniform(5, 10))
                    
                    # Проверяем что фильтры применились корректно
                    self.verify_url_filters(url)

                    # Поиск кнопок сообщений
                    message_buttons = self.find_message_buttons()

                    for button_data in message_buttons:
                        self.stats['total_processed'] += 1

                        # Генерация уникального сообщения
                        ad_info = {
                            'address': button_data.get('address', 'Не указано'),
                            'price': button_data.get('price', 'Не указано'),
                            'ad_id': button_data.get('ad_id', '')
                        }
                        unique_message = self.generate_unique_message(message_template, ad_info)

                        # Отправка сообщения
                        if self.send_message(button_data, unique_message):
                            self.stats['messages_sent'] += 1
                        else:
                            self.stats['errors'] += 1

                        # Добавь random.uniform(3,7) между сообщениями
                        time.sleep(random.uniform(3, 7))

                        # После 50 сообщений: перерыв 30 мин
                        if self.stats['messages_sent'] >= 50:
                            self.logger.info("50 сообщений — перерыв 30 мин")
                            time.sleep(1800)
                            self.driver.quit()
                            self.init_driver()
                            self.login_to_cian()
                            # НЕ continue — просто продолжаем цикл

                    # Сохранение статистики после каждой страницы
                    self.save_stats_to_csv()

                    # После каждой страницы: time.sleep(random.uniform(10, 20))
                    time.sleep(random.uniform(10, 20))

                except Exception as e:
                    self.logger.error(f"Ошибка обработки URL {url}: {e}")
                    self.stats['errors'] += 1
                    continue

            # Если messages_sent > 50: self.driver.quit() и перезапуск
            if self.stats['messages_sent'] > 50:
                self.logger.info("Отправлено более 50 сообщений, перезапускаем драйвер")
                if self.driver:
                    self.driver.quit()
                time.sleep(random.uniform(5, 10))
                if not self.init_driver():
                    raise Exception("Не удалось перезапустить WebDriver")
                if not self.login_to_cian():
                    raise Exception("Не удалось переавторизоваться")

            self.logger.info("Рассылка завершена")

        except Exception as e:
            self.logger.error(f"Критическая ошибка: {e}")
            self.stats['errors'] += 1

        finally:
            if self.driver:
                self.driver.quit()
            self.save_stats_to_csv()

    def generate_unique_message(self, template: str, ad_info: Dict) -> str:
        """Генерация уникального сообщения на основе шаблона и данных объявления"""
        try:
            message = template

            # Замена плейсхолдеров (если есть в шаблоне)
            replacements = {
                '{price}': ad_info.get('price', ''),
                '{address}': ad_info.get('address', ''),
                '{id}': ad_info.get('ad_id', ''),
                '{agency}': 'Самолёт Плюс',
                '{verb}': random.choice(["заметил", "увидел", "обратил внимание"])
            }

            for placeholder, value in replacements.items():
                message = message.replace(placeholder, value)
            
            # Добавляем небольшие случайные пробелы/переносы для уникальности
            # (CIAN может детектировать одинаковые сообщения)
            if random.random() > 0.5:
                # Иногда добавляем дополнительный перенос в конце
                message = message + "\n"

            return message

        except Exception as e:
            self.logger.error(f"Ошибка генерации сообщения: {e}")
            self.stats['errors'] += 1
            return template


def main():
    """Главная функция"""
    from cian_urls_examples import MOSCOW_FLATS_ALL

    bot = CianMailingBot()
    target_urls = MOSCOW_FLATS_ALL[:3]

    message_template = """Здравствуйте!

Я {agency} - ваш надежный партнер в сфере недвижимости.

{verb} ваше объявление по адресу {address} за {price}.

Мы специализируемся на комплексном сопровождении сделок и имеем большой опыт работы с подобными объектами.

Предлагаю обсудить возможности сотрудничества - можем найти покупателей из нашей базы или помочь с маркетингом объекта.

Буду рад ответить на ваши вопросы!

С уважением,
Менеджер по партнерствам
{agency}
📞 +7 (XXX) XXX-XX-XX
📧 info@samolyotplus.ru"""

    bot.run_mailing(target_urls, message_template)


if __name__ == "__main__":
    main()
