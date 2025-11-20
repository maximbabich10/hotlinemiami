#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Полный тестовый цикл:
1. Автоматическая авторизация
2. Применение фильтров через UI
3. Клики по кнопкам "Написать" (без отправки сообщений)
"""

import sys
import time
import random

# Настройка UTF-8
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

from cian_mailer import CianMailingBot
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException


class FullCycleTestBot(CianMailingBot):
    """Бот для полного тестового цикла"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.processed_file = "processed_ads.txt"
        
        # ВАЖНО: Очищаем список перед каждым запуском (тестовый режим)
        # self.clear_processed_list()  # ЗАКОММЕНТИРОВАНО - прогресс сохраняется!
        
        self.processed_ids = self.load_processed_ids()
    
    def clear_processed_list(self):
        """Очищает список обработанных объявлений перед запуском"""
        import os
        if os.path.exists(self.processed_file):
            os.remove(self.processed_file)
            print(f"🗑️  Список обработанных очищен (тестовый режим)")
    
    def load_processed_ids(self):
        """Загружает список обработанных объявлений"""
        try:
            with open(self.processed_file, 'r', encoding='utf-8') as f:
                ids = set(line.strip() for line in f if line.strip())
            print(f"📂 Загружено {len(ids)} обработанных объявлений")
            return ids
        except FileNotFoundError:
            print(f"📂 Файл прогресса не найден, создаю новый")
            return set()
    
    def save_processed_id(self, ad_id):
        """Сохраняет ID обработанного объявления"""
        with open(self.processed_file, 'a', encoding='utf-8') as f:
            f.write(f"{ad_id}\n")
        self.processed_ids.add(ad_id)
    
    def is_processed(self, ad_id):
        """Проверяет, обработано ли объявление"""
        return ad_id in self.processed_ids
    
    def apply_filters_via_ui(self):
        """Применяет фильтры 'От собственника' и 'Без долей' через UI"""
        print("\n" + "="*60)
        print("🔧 ПРИМЕНЕНИЕ ФИЛЬТРОВ ЧЕРЕЗ UI")
        print("="*60)
        try:
            # 1. Найти и кликнуть кнопку "Ещё фильтры"
            print("\n1️⃣ Поиск кнопки 'Ещё фильтры'...")
            more_filters_button = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Ещё фильтры')]"))
            )
            print(f"   ✅ Найдена кнопка")
            self.driver.execute_script("arguments[0].click();", more_filters_button)
            print("   🖱️  Кликаем 'Ещё фильтры'...")
            time.sleep(random.uniform(2, 4))

            # 2. Ожидание модального окна с фильтрами
            print("\n2️⃣ Ожидание модального окна с фильтрами...")
            modal_dialog = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "[data-name='Modal'], [role='dialog']"))
            )
            print("   ✅ Модальное окно открыто")

            # Найдем скроллируемый контейнер внутри модалки (или используем само модальное окно)
            try:
                scrollable_container = modal_dialog.find_element(By.XPATH, ".//div[contains(@class, 'scrollContainer')]")
                print("   ✅ Найден скроллируемый контейнер")
            except NoSuchElementException:
                print("   ℹ️  scrollContainer не найден, используем само модальное окно")
                scrollable_container = modal_dialog

            # 3. Поиск и клик по "Собственник" в разделе "Продавец"
            print("\n3️⃣ Поиск фильтра 'Продавец' → 'Собственник'...")
            try:
                owner_filter_element = WebDriverWait(scrollable_container, 10).until(
                    EC.presence_of_element_located((By.XPATH, ".//span[text()='Собственник']"))
                )
                print(f"   ✅ Найден элемент 'Собственник'")
                self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", owner_filter_element)
                time.sleep(0.5)
                self.driver.execute_script("arguments[0].click();", owner_filter_element)
                print("   🖱️  Кликнул 'Собственник'")
                print("   ✅ Фильтр 'Собственник' применен!")
                time.sleep(random.uniform(1, 2))
            except TimeoutException:
                print("   ⚠️  Фильтр 'Собственник' не найден")

            # 4. Поиск и клик по "Не показывать" в разделе "Доли"
            print("\n4️⃣ Поиск фильтра 'Доли' → 'Не показывать'...")
            try:
                # Скроллим вниз в модалке чтобы найти "Доли"
                self.driver.execute_script("arguments[0].scrollTop += 500;", scrollable_container)
                time.sleep(0.5)
                
                # Ищем заголовок "Доли"
                shares_header = scrollable_container.find_element(By.XPATH, ".//span[text()='Доли']")
                print(f"   ✅ Найден заголовок 'Доли'")
                
                # Ищем "Не показывать" ПОСЛЕ заголовка "Доли" (используя following-sibling)
                # Ищем родительский контейнер с "Доли" и внутри него "Не показывать"
                parent_container = shares_header.find_element(By.XPATH, "./ancestor::*[contains(@class, 'container') or contains(@class, 'section')][1]")
                no_shares_element = parent_container.find_element(By.XPATH, ".//span[text()='Не показывать']")
                
                print(f"   ✅ Найден элемент 'Не показывать' в разделе 'Доли'")
                self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", no_shares_element)
                time.sleep(0.5)
                self.driver.execute_script("arguments[0].click();", no_shares_element)
                print("   🖱️  Кликнул 'Не показывать' для долей")
                print("   ✅ Фильтр 'Без долей' применен!")
                time.sleep(random.uniform(1, 2))
            except Exception as e:
                print(f"   ⚠️  Фильтр 'Доли' не найден: {e}")

            # 5. Закрытие модального окна
            print("\n5️⃣ Закрытие модального окна...")
            try:
                close_button = WebDriverWait(modal_dialog, 15).until(
                    EC.element_to_be_clickable((
                        By.XPATH,
                        "//button[contains(., 'Показать объекты')] | "
                        "//button[contains(., 'Показать')] | "
                        "//button[contains(., 'Применить')] | "
                        "//button[@type='submit']"
                    ))
                )
                print(f"   ✅ Найдена кнопка: {close_button.text}")
                self.driver.execute_script("arguments[0].click();", close_button)
                print("   🖱️  Кликнул 'Показать объекты'")
                time.sleep(random.uniform(3, 5))
            except TimeoutException:
                print("   ⚠️  Кнопка не найдена, пробую ESC...")
                from selenium.webdriver.common.keys import Keys
                modal_dialog.send_keys(Keys.ESCAPE)
                time.sleep(2)

            print("\n✅ ФИЛЬТРЫ ПРИМЕНЕНЫ!")
            print("="*60 + "\n")
            return True

        except Exception as e:
            print(f"\n   ❌ ОШИБКА: {e}")
            return False

    def test_click_write_buttons_with_pagination(self, max_pages=5, max_per_page=10):
        """Тестирует клики по кнопкам на нескольких страницах"""
        print("\n" + "="*60)
        print(f"🧪 ОБРАБОТКА {max_pages} СТРАНИЦ (макс. {max_per_page} объявлений/страницу)")
        print("="*60)
        
        total_processed = 0
        
        for page in range(1, max_pages + 1):
            try:
                print(f"\n{'='*60}")
                print(f"📄 СТРАНИЦА {page}/{max_pages}")
                print(f"{'='*60}")
                
                # Если не первая страница - переходим на неё
                if page > 1:
                    current_url = self.driver.current_url
                    if '&p=' in current_url:
                        # Заменяем номер страницы
                        new_url = current_url.split('&p=')[0] + f'&p={page}'
                    else:
                        # Добавляем параметр страницы
                        new_url = current_url + f'&p={page}'
                    
                    print(f"🌐 Переход на страницу {page}...")
                    self.driver.get(new_url)
                    time.sleep(random.uniform(3, 5))
                
                # Обрабатываем кнопки на текущей странице (ограничение для защиты от капчи)
                processed = self.test_click_write_buttons_on_page(page, max_per_page)
                total_processed += processed
                
                print(f"\n✅ Страница {page} завершена: обработано {processed} объявлений")
                print(f"📊 Всего обработано: {total_processed}")
                
                # Пауза между страницами
                if page < max_pages:
                    pause = random.uniform(45, 75)  # 60 сек в среднем
                    print(f"⏸️  Пауза {pause:.1f} сек перед следующей страницей...")
                    time.sleep(pause)
                    
            except Exception as e:
                print(f"\n❌ ОШИБКА НА СТРАНИЦЕ {page}: {e}")
                import traceback
                traceback.print_exc()
                
                # Сохраняем скриншот ошибки
                try:
                    self.driver.save_screenshot(f"error_page_{page}.png")
                    print(f"📸 Скриншот ошибки: error_page_{page}.png")
                except:
                    pass
                
                print(f"⏭️  Пропускаю страницу {page} и продолжаю...")
                continue
        
        print(f"\n{'='*60}")
        print(f"✅ ВСЕ СТРАНИЦЫ ОБРАБОТАНЫ!")
        print(f"📊 Итого обработано объявлений: {total_processed}")
        print(f"📂 Всего в базе обработанных: {len(self.processed_ids)}")
        print(f"📝 Файл прогресса: {self.processed_file}")
        print(f"{'='*60}")
        
        return total_processed
    
    def test_click_write_buttons_on_page(self, page_num=1, max_per_page=10):
        """Обрабатывает кнопки 'Написать' на текущей странице"""
        
        # ВАЖНО! Скроллим чтобы CIAN подгрузил все кнопки
        print(f"\n🖱️  Прокручиваю страницу для загрузки всех кнопок...")
        self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight/2);")
        time.sleep(2)
        self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(2)
        self.driver.execute_script("window.scrollTo(0, 0);")  # Возвращаемся в начало
        time.sleep(1)
        
        # Ищем кнопки
        print(f"🔍 Поиск кнопок 'Написать' на странице {page_num}...")
        
        # ОТЛАДКА: Сколько карточек на странице?
        cards = self.driver.find_elements(By.CSS_SELECTOR, "[data-name='CardComponent'], .card, [data-testid*='offer-card']")
        print(f"   📦 Найдено карточек на странице: {len(cards)}")
        
        buttons_data = self.find_message_buttons()
        
        print(f"✅ Найдено {len(buttons_data)} кнопок 'Написать'")
        
        if not buttons_data:
            print("❌ Кнопки 'Написать' не найдены!")
            print("   📸 Сохраняю скриншот для отладки...")
            self.driver.save_screenshot(f"no_buttons_page_{page_num}.png")
            print(f"   📋 URL: {self.driver.current_url}")
            return 0
        
        # Дедупликация по ad_id
        seen_ids = set()
        unique_buttons = []
        for btn_data in buttons_data:
            ad_id = btn_data.get('ad_id', 'unknown')
            if ad_id not in seen_ids:
                seen_ids.add(ad_id)
                unique_buttons.append(btn_data)
        
        print(f"✅ Уникальных объявлений: {len(unique_buttons)}")
        
        # ОГРАНИЧЕНИЕ для защиты от капчи!
        buttons_to_test = unique_buttons[:max_per_page]
        print(f"\n📨 Будет обработано {len(buttons_to_test)} из {len(unique_buttons)} объявлений (защита от капчи)\n")
        
        for i, btn_data in enumerate(buttons_to_test, 1):
            try:
                address = btn_data.get('address', 'Не указано')
                price = btn_data.get('price', 'Не указано')
                ad_id = btn_data.get('ad_id', 'unknown')
                button = btn_data.get('button')
                
                print(f"{'='*60}")
                print(f"📨 Объявление {i}/{len(buttons_to_test)}")
                print(f"{'='*60}")
                print(f"   ID: {ad_id}")
                print(f"   📍 {address}")
                print(f"   💰 {price}")
                
                # ПРОВЕРКА: Уже обрабатывали?
                if self.is_processed(ad_id):
                    print(f"   ⏭️  УЖЕ ОБРАБОТАНО РАНЕЕ - пропускаю!")
                    continue
                
                # Скроллим к кнопке
                print(f"\n   🖱️  Скроллим к кнопке...")
                self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                time.sleep(random.uniform(0.3, 0.7))  # Ускорили!
                
                # Кликаем
                print(f"   🖱️  Кликаем 'Написать'...")
                try:
                    try:
                        button.click()
                    except:
                        self.driver.execute_script("arguments[0].click();", button)
                    
                    # ШАГ 1: Ждём появления iframe с чатом
                    print(f"   ⏳ Жду появления iframe чата (макс 8 сек)...")
                    try:
                        iframe = WebDriverWait(self.driver, 8).until(
                            EC.presence_of_element_located((By.CSS_SELECTOR, "iframe[data-testid='ChatModal']"))
                        )
                        print(f"   ✅ Iframe найден!")
                    except TimeoutException:
                        print(f"   ❌ Iframe не появился за 8 секунд!")
                        self.driver.save_screenshot(f"no_iframe_{ad_id}.png")
                        continue
                    
                    # ШАГ 2: Переключаемся в iframe
                    print(f"   🔄 Переключаюсь в iframe...")
                    self.driver.switch_to.frame(iframe)
                    in_iframe = True
                    
                    # ШАГ 3: Ждём загрузки содержимого iframe (ВАЖНО!)
                    print(f"   ⏳ Жду загрузки содержимого iframe...")
                    time.sleep(5)  # Даём время на загрузку страницы внутри iframe
                    
                    # ШАГ 4: Ищем textarea внутри iframe
                    print(f"   🔍 Ищу textarea внутри iframe...")
                    try:
                        message_form = WebDriverWait(self.driver, 10).until(
                            EC.element_to_be_clickable((
                                By.CSS_SELECTOR,
                                "textarea[data-name='MessageInputField_textarea']"
                            ))
                        )
                        print(f"   ✅ Textarea найден И ГОТОВ!")
                    except TimeoutException:
                        print(f"   ❌ Textarea не найден внутри iframe!")
                        self.driver.save_screenshot(f"no_textarea_{ad_id}.png")
                        self.driver.switch_to.default_content()
                        continue
                    
                    # ШАГ 4: Проверяем, есть ли уже история переписки
                    print(f"   🔍 Проверяю наличие существующего диалога...")
                    try:
                        existing_messages = self.driver.find_elements(By.CSS_SELECTOR, "[data-name*='Message'], .message, [class*='message']")
                        if len(existing_messages) > 3:  # Больше 3 элементов = есть история
                            print(f"   ⏭️  ДИАЛОГ УЖЕ СУЩЕСТВУЕТ ({len(existing_messages)} сообщений) - пропускаю!")
                            self.save_processed_id(ad_id)
                            if in_iframe:
                                self.driver.switch_to.default_content()
                            continue
                    except:
                        pass
                    
                    # ШАГ 5: Проверяем что поле готово
                    if not message_form:
                        print(f"   ❌ Поле ввода не найдено!")
                        if in_iframe:
                            self.driver.switch_to.default_content()
                        continue
                    
                    print(f"   ✅ Поле ГОТОВО к вводу!")
                    
                    # Проверяем что поле действительно видимо и активно
                    print(f"   📋 Тип: {message_form.tag_name}")
                    print(f"   📋 Placeholder: {message_form.get_attribute('placeholder')}")
                    print(f"   📋 MaxLength: {message_form.get_attribute('maxlength')}")
                    print(f"   📋 Видимость: {message_form.is_displayed()}")
                    print(f"   📋 Активность: {message_form.is_enabled()}")
                    
                    # ВВОДИМ СООБЩЕНИЕ - СЛУЧАЙНЫЙ ВАРИАНТ (защита от детекта)
                    
                    messages = [
                        # ВАРИАНТ 1 (оригинал)
                        """Здравствуйте!

Меня зовут Александр, я занимаюсь продажей недвижимости в Москве (ЦАО). Предлагаю вам быструю и выгодную продажу вашей квартиры.

- Ипотечные программы на вторичное жилье со ставкой от 12,25% при первоначальном взносе от 27%
- Благодаря правильному подходу, вашу квартиру смогу продать в кратчайшие сроки
- Высокий спрос на жильё в Москве способствует быстрой реализации объектов
- Я лично сопровождаю каждый показ и веду переговоры для максимального результата

Размещение и консультации с нашей стороны — бесплатно и без обязательств.

Если интересно, могу выслать презентацию с примером нашей работы и подходом.

Буду рад помочь!
Связаться со мной можно по телефону: 8 (996) 090-58-44

Александр, эксперт по недвижимости, ул. Большая Дмитровка, д. 32, стр. 4""",
                        
                        # ВАРИАНТ 2 (перефразированный)
                        """Добрый день!

Александр, специалист по продаже недвижимости в ЦАО Москвы. Помогу быстро и выгодно реализовать вашу квартиру.

Что я предлагаю:
- Ипотека на вторичку от 12,25% годовых (первый взнос от 27%)
- Профессиональный подход позволяет продать квартиру максимально быстро
- Благодаря высокому спросу на московское жильё, объекты реализуются оперативно
- Личное сопровождение всех показов и ведение переговоров с покупателями

Консультации и размещение объявлений — бесплатно, без каких-либо обязательств.

По вашему желанию вышлю презентацию с примерами моей работы.

С удовольствием помогу!
Телефон: 8 (996) 090-58-44

Александр, эксперт по недвижимости
ул. Большая Дмитровка, д. 32, стр. 4""",
                        
                        # ВАРИАНТ 3 (короче, акцент на результат)
                        """Здравствуйте!

Меня зовут Александр, помогаю с продажей квартир в Москве (ЦАО). Специализируюсь на быстрой и выгодной реализации.

Преимущества работы со мной:
- Ипотечные программы для покупателей от 12,25% (взнос от 27%)
- Профессиональный подход — продажа в кратчайшие сроки
- Высокий спрос на московскую недвижимость работает на вас
- Личное участие в каждом показе и переговорах

Размещение объявлений и консультации — полностью бесплатны.

Готов выслать презентацию с примерами успешных сделок.

Буду рад сотрудничеству!
Мой телефон: 8 (996) 090-58-44

Александр, риэлтор
ул. Большая Дмитровка, д. 32, стр. 4""",
                        
                        # ВАРИАНТ 4 (деловой стиль)
                        """Приветствую!

Александр, эксперт по недвижимости в ЦАО Москвы. Предлагаю профессиональную помощь в продаже вашей квартиры.

Что входит в мой сервис:
- Подбор ипотечных программ для покупателей (ставка от 12,25%, взнос от 27%)
- Эффективная стратегия продажи — минимальные сроки реализации
- Использование высокого спроса на столичное жильё для быстрой продажи
- Персональное сопровождение показов и профессиональное ведение переговоров

Все консультации и размещение — бесплатно, никаких обязательств с вашей стороны.

Могу предоставить презентацию с кейсами и подходом к работе.

Буду рад помочь в продаже!
Контактный телефон: 8 (996) 090-58-44

Александр, специалист по недвижимости
Адрес: ул. Большая Дмитровка, д. 32, стр. 4"""
                    ]
                    
                    message_text = random.choice(messages)
                    print(f"   🎲 Выбран вариант сообщения: {messages.index(message_text) + 1}/4")
                    
                    print(f"\n   🔥 НАЧИНАЮ ВВОД ТЕКСТА...")
                    
                    # Скроллим к элементу
                    self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", message_form)
                    time.sleep(0.5)
                    
                    # Фокус + клик
                    print(f"   🎯 Фокусируюсь и кликаю...")
                    self.driver.execute_script("arguments[0].focus();", message_form)
                    time.sleep(0.3)
                    try:
                        message_form.click()
                    except:
                        self.driver.execute_script("arguments[0].click();", message_form)
                    time.sleep(0.5)
                    
                    # ВСТАВЛЯЕМ ТЕКСТ - используем execCommand для эмуляции Ctrl+V
                    print(f"   📋 Вставляю текст через execCommand (эмуляция Ctrl+V)...")
                    print(f"   📏 Длина текста: {len(message_text)} символов")
                    
                    # Фокус на поле
                    message_form.click()
                    time.sleep(0.3)
                    
                    # МЕТОД: Используем execCommand('insertText') - как настоящий ввод!
                    self.driver.execute_script("""
                        const textarea = arguments[0];
                        const text = arguments[1];
                        
                        // Фокус
                        textarea.focus();
                        
                        // Очищаем
                        textarea.value = '';
                        textarea.selectionStart = 0;
                        textarea.selectionEnd = 0;
                        
                        // Вставляем через execCommand (как настоящий ввод!)
                        document.execCommand('insertText', false, text);
                        
                        // Если не сработало - fallback на value
                        if (!textarea.value || textarea.value.length < 50) {
                            textarea.value = text;
                        }
                        
                        // Trigger events
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        textarea.dispatchEvent(new Event('change', { bubbles: true }));
                        textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                    """, message_form, message_text)
                    time.sleep(2.0)
                    
                    # Проверяем результат
                    current_value = message_form.get_attribute('value')
                    print(f"   📊 В памяти: {len(current_value) if current_value else 0}/{len(message_text)} символов")
                    
                    # Делаем скриншот чтобы ВИЗУАЛЬНО проверить
                    screenshot_name = f"check_text_{ad_id}.png"
                    self.driver.save_screenshot(screenshot_name)
                    print(f"   📸 Скриншот для проверки: {screenshot_name}")
                    
                    print(f"\n   ✅ ВВОД ЗАВЕРШЕН!")
                    
                    # Сохраняем скриншот ПОСЛЕ ввода
                    screenshot_name = f"message_input_{ad_id}.png"
                    self.driver.save_screenshot(screenshot_name)
                    print(f"   📸 Скриншот: {screenshot_name}")
                    
                    # ВАЖНО: Пауза для ВИЗУАЛЬНОЙ проверки текста
                    print(f"   ⏸️  Пауза 10 сек - ПРОВЕРЬТЕ визуально текст в окне!")
                    print(f"   👀 Весь текст виден? Или только приветствие?")
                    time.sleep(10)
                    
                    # НЕ ОТПРАВЛЯЕМ - только тестируем вставку
                    print(f"   ⏭️  Сообщение НЕ отправлено (тестовый режим)")
                    
                    # СОХРАНЯЕМ ID КАК ОБРАБОТАННЫЙ!
                    self.save_processed_id(ad_id)
                    print(f"   💾 ID {ad_id} сохранён в список обработанных")
                    
                    # Закрываем окно (ESC)
                    print(f"   🔙 Закрываю окно...")
                    from selenium.webdriver.common.keys import Keys
                    message_form.send_keys(Keys.ESCAPE)
                    time.sleep(0.5)
                    
                    # ВАЖНО: Если мы были в iframe - возвращаемся в основной контекст!
                    if in_iframe:
                        print(f"   🔄 Возвращаюсь из iframe...")
                        self.driver.switch_to.default_content()
                    
                    print(f"   ✅ OK!")
                
                except Exception as e:
                    print(f"   ❌ ОШИБКА: {e}")
                    self.driver.save_screenshot(f"error_{i}.png")
                
                # Пауза между кликами (оптимизированная для ~140-150 сообщ/час)
                if i < len(buttons_to_test):
                    pause = random.uniform(20, 30)  # 25 сек в среднем (спокойнее)
                    print(f"\n   ⏸️  Пауза {pause:.1f} сек перед следующим объявлением...\n")
                    time.sleep(pause)
            
            except Exception as e:
                print(f"   ❌ Ошибка: {e}")
                continue
        
        return len(buttons_to_test)
        print(f"   • Всего найдено: {len(buttons_data)}")


def main():
    print("""
╔═══════════════════════════════════════════════════════════╗
║              ПОЛНЫЙ ТЕСТОВЫЙ ЦИКЛ                          ║
║  1. Авторизация                                           ║
║  2. Применение фильтров                                   ║
║  3. Клики по кнопкам "Написать"                           ║
╚═══════════════════════════════════════════════════════════╝
    """)
    
    bot = FullCycleTestBot()
    
    try:
        # ШАГ 1: Инициализация
        if not bot.init_driver():
            print("❌ Ошибка запуска браузера")
            return
        
        # ШАГ 2: Авторизация
        if not bot.login_to_cian():
            print("❌ Ошибка авторизации")
            bot.driver.quit()
            return
        
        print("\n✅ Авторизация успешна!\n")
        time.sleep(3)
        
        # ШАГ 3: Открываем страницу поиска
        base_url = "https://www.cian.ru/cat.php?deal_type=sale&offer_type=flat&region=1"
        
        print(f"🌐 Открываем страницу поиска...")
        bot.driver.get(base_url)
        time.sleep(random.uniform(3, 5))
        
        # ШАГ 4: Применяем фильтры через UI
        if bot.apply_filters_via_ui():
            print("✅ Фильтры применены!")
            
            # Ждем обновления страницы
            time.sleep(random.uniform(5, 8))
            
            # ШАГ 5: Обрабатываем несколько страниц (оптимизировано для ~140-150 сообщ/час)
            # 140-150 сообщений/час = 10 объявлений/страницу × 14 страниц ≈ 1 час работы
            bot.test_click_write_buttons_with_pagination(max_pages=14, max_per_page=10)  # ~140 объявлений за час
        else:
            print("❌ Не удалось применить фильтры")
        
        print("\n✅ Работа завершена! Закрываю браузер через 5 сек...")
        time.sleep(5)
        bot.driver.quit()
        print("\n✅ Тест завершен!")
        
    except KeyboardInterrupt:
        print("\n⏹️  Прервано пользователем")
        if bot.driver:
            bot.driver.quit()
    except Exception as e:
        print(f"\n❌ Критическая ошибка: {e}")
        import traceback
        error_text = traceback.format_exc()
        print(error_text)
        
        # Сохраняем ошибку в файл
        with open("error_log.txt", "a", encoding="utf-8") as f:
            from datetime import datetime
            f.write(f"\n{'='*60}\n")
            f.write(f"Ошибка: {datetime.now()}\n")
            f.write(f"{'='*60}\n")
            f.write(error_text)
            f.write(f"\n{'='*60}\n\n")
        
        print("📝 Ошибка сохранена в error_log.txt")
        
        if bot.driver:
            bot.driver.save_screenshot("error_screenshot.png")
            print("📸 Скриншот сохранён: error_screenshot.png")
            bot.driver.quit()


if __name__ == "__main__":
    main()

