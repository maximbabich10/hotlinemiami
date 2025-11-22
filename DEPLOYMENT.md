# 🚀 Развертывание на сервере

## Требования

### Минимальные требования
- **OS**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **CPU**: 2 cores
- **RAM**: 2GB
- **Disk**: 20GB
- **Node.js**: 18.0.0+

### Рекомендуемые требования
- **OS**: Ubuntu 22.04 LTS
- **CPU**: 4 cores
- **RAM**: 4GB
- **Disk**: 50GB
- **Node.js**: 20.0.0+

## Выбор хостинга

### Рекомендуемые провайдеры

| Провайдер | Цена/мес | RAM | CPU | Disk | Примечание |
|-----------|----------|-----|-----|------|------------|
| [Hetzner](https://www.hetzner.com/) | €4.15 | 4GB | 2 vCPU | 40GB | Лучшее соотношение цена/качество |
| [DigitalOcean](https://www.digitalocean.com/) | $12 | 2GB | 1 vCPU | 50GB | Простая настройка |
| [Vultr](https://www.vultr.com/) | $6 | 2GB | 1 vCPU | 55GB | Хорошая производительность |
| [Selectel](https://selectel.ru/) | ₽500 | 2GB | 1 vCPU | 40GB | Российский провайдер |

### Что НЕ рекомендуется
- ❌ Shared hosting (нет доступа к Node.js)
- ❌ Серверы с RAM < 2GB (браузер требует много памяти)
- ❌ Серверы без SSD (медленная работа БД)

## Пошаговая установка

### Шаг 1: Создание сервера

#### Hetzner (рекомендуется)

1. Зарегистрируйтесь на [hetzner.com](https://www.hetzner.com/)
2. Перейдите в Cloud Console
3. Создайте новый проект
4. Нажмите "Add Server"
5. Выберите:
   - **Location**: Nuremberg (Germany) или Helsinki (Finland)
   - **Image**: Ubuntu 22.04
   - **Type**: CPX11 (2 vCPU, 2GB RAM) - €4.15/мес
   - **SSH Key**: Добавьте свой публичный SSH ключ
6. Нажмите "Create & Buy now"

#### DigitalOcean

1. Зарегистрируйтесь на [digitalocean.com](https://www.digitalocean.com/)
2. Создайте новый Droplet
3. Выберите:
   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Basic ($12/мес, 2GB RAM)
   - **Datacenter**: Amsterdam или Frankfurt
   - **SSH Key**: Добавьте свой ключ
4. Нажмите "Create Droplet"

### Шаг 2: Подключение к серверу

```bash
# Замените YOUR_SERVER_IP на IP вашего сервера
ssh root@YOUR_SERVER_IP
```

### Шаг 3: Обновление системы

```bash
# Обновление пакетов
apt update && apt upgrade -y

# Установка необходимых пакетов
apt install -y curl wget git build-essential
```

### Шаг 4: Установка Node.js

```bash
# Установка Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Проверка версии
node -v  # Должно быть v20.x.x
npm -v   # Должно быть 10.x.x
```

### Шаг 5: Установка зависимостей для Puppeteer

```bash
# Установка зависимостей для Chrome
apt install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2
```

### Шаг 6: Создание пользователя (опционально, но рекомендуется)

```bash
# Создание пользователя cian-bot
adduser cian-bot

# Добавление в группу sudo
usermod -aG sudo cian-bot

# Переключение на пользователя
su - cian-bot
```

### Шаг 7: Клонирование репозитория

```bash
# Клонирование
git clone https://github.com/yourusername/hotlinemiami.git
cd hotlinemiami

# Установка зависимостей
npm install
```

### Шаг 8: Настройка `.env`

```bash
# Создание .env из примера
cp env.example .env

# Редактирование .env
nano .env
```

Минимальная конфигурация:
```env
TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather

# Настройки рассылки
MAX_PAGES=5
MAX_PER_PAGE=10
MIN_PAUSE=3
MAX_PAUSE=5
```

### Шаг 9: Тестовый запуск

```bash
# Запуск бота
npm start
```

Если все работает, вы увидите:
```
🤖 Telegram бот запущен...
✅ Ожидаю команды...
```

Нажмите `Ctrl+C` для остановки.

### Шаг 10: Настройка автозапуска (systemd)

```bash
# Создание systemd service
sudo nano /etc/systemd/system/cian-bot.service
```

Вставьте:
```ini
[Unit]
Description=CIAN Telegram Bot
After=network.target

[Service]
Type=simple
User=cian-bot
WorkingDirectory=/home/cian-bot/hotlinemiami
ExecStart=/usr/bin/node telegram-bot.js
Restart=always
RestartSec=10
StandardOutput=append:/home/cian-bot/hotlinemiami/bot.log
StandardError=append:/home/cian-bot/hotlinemiami/bot.error.log

# Environment variables (опционально, если не используете .env)
# Environment="TELEGRAM_BOT_TOKEN=your_token"

[Install]
WantedBy=multi-user.target
```

Сохраните (`Ctrl+X`, `Y`, `Enter`).

```bash
# Перезагрузка systemd
sudo systemctl daemon-reload

# Включение автозапуска
sudo systemctl enable cian-bot

# Запуск сервиса
sudo systemctl start cian-bot

# Проверка статуса
sudo systemctl status cian-bot
```

### Шаг 11: Проверка логов

```bash
# Просмотр логов в реальном времени
sudo journalctl -u cian-bot -f

# Последние 100 строк
sudo journalctl -u cian-bot -n 100

# Логи за сегодня
sudo journalctl -u cian-bot --since today
```

## Управление сервисом

### Запуск
```bash
sudo systemctl start cian-bot
```

### Остановка
```bash
sudo systemctl stop cian-bot
```

### Перезапуск
```bash
sudo systemctl restart cian-bot
```

### Проверка статуса
```bash
sudo systemctl status cian-bot
```

### Отключение автозапуска
```bash
sudo systemctl disable cian-bot
```

## Обновление бота

```bash
# Остановка сервиса
sudo systemctl stop cian-bot

# Переход в директорию проекта
cd /home/cian-bot/hotlinemiami

# Получение обновлений
git pull origin main

# Установка новых зависимостей
npm install

# Запуск сервиса
sudo systemctl start cian-bot

# Проверка логов
sudo journalctl -u cian-bot -f
```

## Бэкап базы данных

### Ручной бэкап

```bash
# Создание бэкапа
cp /home/cian-bot/hotlinemiami/users.db /home/cian-bot/backups/users_$(date +%Y%m%d_%H%M%S).db
```

### Автоматический бэкап (cron)

```bash
# Создание директории для бэкапов
mkdir -p /home/cian-bot/backups

# Редактирование crontab
crontab -e
```

Добавьте:
```bash
# Бэкап каждый день в 3:00
0 3 * * * cp /home/cian-bot/hotlinemiami/users.db /home/cian-bot/backups/users_$(date +\%Y\%m\%d_\%H\%M\%S).db

# Удаление старых бэкапов (старше 30 дней)
0 4 * * * find /home/cian-bot/backups -name "users_*.db" -mtime +30 -delete
```

### Восстановление из бэкапа

```bash
# Остановка сервиса
sudo systemctl stop cian-bot

# Восстановление
cp /home/cian-bot/backups/users_20251122_030000.db /home/cian-bot/hotlinemiami/users.db

# Запуск сервиса
sudo systemctl start cian-bot
```

## Мониторинг

### Проверка использования ресурсов

```bash
# CPU и RAM
htop

# Использование диска
df -h

# Размер БД
du -h /home/cian-bot/hotlinemiami/users.db
```

### Настройка алертов (опционально)

Можно использовать:
- [UptimeRobot](https://uptimerobot.com/) - бесплатный мониторинг
- [Netdata](https://www.netdata.cloud/) - детальный мониторинг
- Telegram уведомления через отдельного бота

## Безопасность

### Настройка firewall

```bash
# Установка UFW
sudo apt install -y ufw

# Разрешить SSH
sudo ufw allow 22/tcp

# Включить firewall
sudo ufw enable

# Проверка статуса
sudo ufw status
```

### Отключение root логина

```bash
# Редактирование SSH конфига
sudo nano /etc/ssh/sshd_config
```

Измените:
```
PermitRootLogin no
PasswordAuthentication no
```

Перезапустите SSH:
```bash
sudo systemctl restart sshd
```

### Обновление системы

```bash
# Автоматические обновления безопасности
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

## Troubleshooting

### Бот не запускается

```bash
# Проверка логов
sudo journalctl -u cian-bot -n 50

# Проверка .env файла
cat /home/cian-bot/hotlinemiami/.env

# Проверка прав доступа
ls -la /home/cian-bot/hotlinemiami/
```

### Ошибка "Cannot find module"

```bash
# Переустановка зависимостей
cd /home/cian-bot/hotlinemiami
rm -rf node_modules package-lock.json
npm install
```

### Ошибка "Permission denied"

```bash
# Исправление прав доступа
sudo chown -R cian-bot:cian-bot /home/cian-bot/hotlinemiami
```

### База данных заблокирована

```bash
# Остановка всех процессов
sudo systemctl stop cian-bot

# Удаление lock файла
rm /home/cian-bot/hotlinemiami/users.db-journal

# Запуск
sudo systemctl start cian-bot
```

### Нехватка памяти

```bash
# Создание swap файла (2GB)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Добавление в /etc/fstab для автозапуска
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Масштабирование

### Для большого количества пользователей

Если у вас > 10 активных пользователей:

1. **Увеличьте ресурсы сервера:**
   - RAM: 4GB → 8GB
   - CPU: 2 cores → 4 cores

2. **Оптимизируйте БД:**
   ```bash
   # Индексы (уже созданы в database.js)
   sqlite3 users.db "CREATE INDEX IF NOT EXISTS idx_telegram_id ON users(telegram_id);"
   sqlite3 users.db "CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(telegram_id);"
   ```

3. **Настройте логирование:**
   ```bash
   # Ротация логов
   sudo nano /etc/logrotate.d/cian-bot
   ```
   
   Добавьте:
   ```
   /home/cian-bot/hotlinemiami/*.log {
       daily
       rotate 7
       compress
       delaycompress
       notifempty
       create 0640 cian-bot cian-bot
   }
   ```

## Стоимость

### Примерная стоимость на 1 месяц

| Компонент | Цена |
|-----------|------|
| Сервер (Hetzner CPX11) | €4.15 |
| Домен (опционально) | €1-2 |
| **Итого** | **€5-6** |

### Бесплатные альтернативы (для тестирования)

- [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) - бесплатно навсегда (2 VM)
- [Google Cloud Free Tier](https://cloud.google.com/free) - $300 на 90 дней
- [AWS Free Tier](https://aws.amazon.com/free/) - 12 месяцев бесплатно

⚠️ **Внимание**: Бесплатные серверы могут быть медленными и иметь ограничения.

## Дополнительные ресурсы

- [Документация systemd](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Документация UFW](https://help.ubuntu.com/community/UFW)
- [Документация SQLite](https://www.sqlite.org/docs.html)
- [Документация Node.js](https://nodejs.org/en/docs/)

---

**Удачного развертывания! 🚀**

