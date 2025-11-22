# 📚 API Reference

## Database Module (`database.js`)

### Constructor

```javascript
const Database = require('./database');
const db = new Database(dbPath);
```

**Parameters:**
- `dbPath` (string, optional): Path to SQLite database file. Default: `./users.db`

**Example:**
```javascript
const db = new Database('./my-users.db');
```

---

### Methods

#### `registerUser(telegramId, phoneNumber, cianLogin, cianPassword)`

Регистрирует нового пользователя или обновляет существующего.

**Parameters:**
- `telegramId` (number): Telegram user ID
- `phoneNumber` (string): Phone number (10 digits)
- `cianLogin` (string, optional): CIAN email
- `cianPassword` (string, optional): CIAN password

**Returns:** `Promise<Object>`
```javascript
{
    telegramId: 792737507,
    phoneNumber: "9771234567",
    changes: 1
}
```

**Example:**
```javascript
await db.registerUser(792737507, "9771234567");
```

---

#### `getUser(telegramId)`

Получает данные пользователя.

**Parameters:**
- `telegramId` (number): Telegram user ID

**Returns:** `Promise<Object|undefined>`
```javascript
{
    telegram_id: 792737507,
    phone_number: "9771234567",
    cian_login: null,
    cian_password: null,
    is_active: 1,
    created_at: "2025-11-22 15:30:00",
    updated_at: "2025-11-22 15:30:00"
}
```

**Example:**
```javascript
const user = await db.getUser(792737507);
if (user) {
    console.log(`Phone: ${user.phone_number}`);
}
```

---

#### `updateCianCredentials(telegramId, cianLogin, cianPassword)`

Обновляет учетные данные CIAN.

**Parameters:**
- `telegramId` (number): Telegram user ID
- `cianLogin` (string): CIAN email
- `cianPassword` (string): CIAN password

**Returns:** `Promise<Object>`
```javascript
{
    changes: 1
}
```

**Example:**
```javascript
await db.updateCianCredentials(792737507, "user@mail.ru", "password123");
```

---

#### `deactivateUser(telegramId)`

Деактивирует пользователя (не удаляет из БД).

**Parameters:**
- `telegramId` (number): Telegram user ID

**Returns:** `Promise<Object>`
```javascript
{
    changes: 1
}
```

**Example:**
```javascript
await db.deactivateUser(792737507);
```

---

#### `createSession(telegramId)`

Создает новую сессию рассылки.

**Parameters:**
- `telegramId` (number): Telegram user ID

**Returns:** `Promise<Object>`
```javascript
{
    sessionId: 1
}
```

**Example:**
```javascript
const session = await db.createSession(792737507);
console.log(`Session ID: ${session.sessionId}`);
```

---

#### `updateSession(sessionId, adsProcessed, status)`

Обновляет статус сессии.

**Parameters:**
- `sessionId` (number): Session ID
- `adsProcessed` (number): Number of ads processed
- `status` (string): Status (`'running'`, `'completed'`, `'failed'`)

**Returns:** `Promise<Object>`
```javascript
{
    changes: 1
}
```

**Example:**
```javascript
await db.updateSession(1, 15, 'completed');
```

---

#### `getUserStats(telegramId)`

Получает статистику пользователя.

**Parameters:**
- `telegramId` (number): Telegram user ID

**Returns:** `Promise<Object>`
```javascript
{
    total_sessions: 5,
    total_ads: 75,
    last_session: "2025-11-22 15:30:00"
}
```

**Example:**
```javascript
const stats = await db.getUserStats(792737507);
console.log(`Total ads: ${stats.total_ads}`);
```

---

#### `close()`

Закрывает соединение с БД.

**Returns:** `Promise<void>`

**Example:**
```javascript
await db.close();
```

---

## CianMailer Module (`cian-mailer.js`)

### Constructor

```javascript
const CianMailer = require('./cian-mailer');
const mailer = new CianMailer(config);
```

**Parameters:**
- `config` (object): Configuration object

**Config Options:**
```javascript
{
    phone: "9771234567",           // Phone number (required)
    maxPages: 5,                   // Max pages to process
    maxPerPage: 10,                // Max ads per page
    minPause: 3,                   // Min pause between ads (sec)
    maxPause: 5,                   // Max pause between ads (sec)
    alwaysProcess: false,          // Process already processed ads
    captchaApiKey: "your_key",     // 2Captcha API key (optional)
    onCodeRequest: async () => {}, // Callback for SMS code
    notifier: (event, payload) => {} // Callback for notifications
}
```

**Example:**
```javascript
const mailer = new CianMailer({
    phone: "9771234567",
    maxPages: 5,
    onCodeRequest: async () => {
        return await promptUser("Enter SMS code:");
    },
    notifier: (event, payload) => {
        if (event === 'ad-start') {
            console.log(`Processing ad: ${payload.adId}`);
        }
    }
});
```

---

### Methods

#### `run()`

Запускает процесс рассылки.

**Returns:** `Promise<Object>`
```javascript
{
    success: true,
    processed: 15,
    error: null
}
```

**Example:**
```javascript
const result = await mailer.run();
if (result.success) {
    console.log(`Processed ${result.processed} ads`);
} else {
    console.error(`Error: ${result.error}`);
}
```

---

### Notifier Events

#### `ad-start`

Вызывается при начале обработки объявления.

**Payload:**
```javascript
{
    index: 1,
    total: 10,
    adId: "123456789",
    address: "Москва, ул. Ленина, д. 1",
    price: "5 000 000 ₽"
}
```

#### `ad-complete`

Вызывается после успешной обработки объявления.

**Payload:**
```javascript
{
    adId: "123456789"
}
```

**Example:**
```javascript
const mailer = new CianMailer({
    phone: "9771234567",
    notifier: (event, payload) => {
        switch (event) {
            case 'ad-start':
                console.log(`[${payload.index}/${payload.total}] Processing: ${payload.adId}`);
                break;
            case 'ad-complete':
                console.log(`✅ Completed: ${payload.adId}`);
                break;
        }
    }
});
```

---

## Telegram Bot Commands

### User Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Start bot | `/start` |
| `/register` | Register user | `/register` |
| `/profile` | View profile | `/profile` |
| `/update` | Update phone | `/update` |
| `/cancel` | Cancel operation | `/cancel` |

### Button Actions

| Button | Action |
|--------|--------|
| ▶️ Запустить рассылку | Start mailing |
| ⏹️ Остановить рассылку | Stop mailing |
| 📊 Статистика | View statistics |
| 👤 Профиль | View profile |
| ℹ️ Помощь | Show help |

---

## Database Schema

### Table: `users`

```sql
CREATE TABLE users (
    telegram_id INTEGER PRIMARY KEY,
    phone_number TEXT NOT NULL,
    cian_login TEXT,
    cian_password TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `sessions`

```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    ads_processed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);
```

---

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | ✅ | - |
| `MAX_PAGES` | Max pages to process | ❌ | 5 |
| `MAX_PER_PAGE` | Max ads per page | ❌ | 10 |
| `MIN_PAUSE` | Min pause (sec) | ❌ | 3 |
| `MAX_PAUSE` | Max pause (sec) | ❌ | 5 |
| `CAPTCHA_API_KEY` | 2Captcha API key | ❌ | - |
| `PROXY_URL` | Proxy URL | ❌ | - |

---

## Error Handling

### Database Errors

```javascript
try {
    await db.registerUser(telegramId, phoneNumber);
} catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
        console.error('User already exists');
    } else {
        console.error('Database error:', error.message);
    }
}
```

### CianMailer Errors

```javascript
try {
    const result = await mailer.run();
    if (!result.success) {
        console.error('Mailing failed:', result.error);
    }
} catch (error) {
    console.error('Critical error:', error.message);
}
```

---

## Examples

### Complete Example: Registration and Mailing

```javascript
const Database = require('./database');
const CianMailer = require('./cian-mailer');

async function main() {
    const db = new Database();
    const telegramId = 792737507;
    
    // 1. Register user
    await db.registerUser(telegramId, "9771234567");
    console.log('✅ User registered');
    
    // 2. Get user data
    const user = await db.getUser(telegramId);
    console.log(`📱 Phone: ${user.phone_number}`);
    
    // 3. Create session
    const session = await db.createSession(telegramId);
    console.log(`📊 Session ID: ${session.sessionId}`);
    
    // 4. Start mailing
    const mailer = new CianMailer({
        phone: user.phone_number,
        maxPages: 5,
        onCodeRequest: async () => {
            // Request SMS code from user
            return "1234"; // Replace with actual code
        },
        notifier: (event, payload) => {
            if (event === 'ad-start') {
                console.log(`Processing: ${payload.adId}`);
            }
        }
    });
    
    const result = await mailer.run();
    
    // 5. Update session
    await db.updateSession(
        session.sessionId,
        result.processed,
        result.success ? 'completed' : 'failed'
    );
    
    // 6. Get stats
    const stats = await db.getUserStats(telegramId);
    console.log(`📊 Total ads: ${stats.total_ads}`);
    
    // 7. Close database
    await db.close();
}

main().catch(console.error);
```

### Example: Custom Notifier

```javascript
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const mailer = new CianMailer({
    phone: "9771234567",
    notifier: (event, payload) => {
        const chatId = 792737507;
        
        if (event === 'ad-start') {
            bot.sendMessage(chatId, `
📨 Processing ad:
ID: ${payload.adId}
Address: ${payload.address}
Price: ${payload.price}
            `);
        } else if (event === 'ad-complete') {
            bot.sendMessage(chatId, `✅ Completed: ${payload.adId}`);
        }
    }
});
```

### Example: Multiple Users

```javascript
const db = new Database();

// Register multiple users
const users = [
    { id: 792737507, phone: "9771234567" },
    { id: 7375071931, phone: "9261234567" }
];

for (const user of users) {
    await db.registerUser(user.id, user.phone);
    console.log(`✅ Registered: ${user.id}`);
}

// Get all users
const allUsers = await db.db.all('SELECT * FROM users');
console.log(`Total users: ${allUsers.length}`);
```

---

## TypeScript Definitions (Future)

```typescript
interface User {
    telegram_id: number;
    phone_number: string;
    cian_login?: string;
    cian_password?: string;
    is_active: number;
    created_at: string;
    updated_at: string;
}

interface Session {
    id: number;
    telegram_id: number;
    started_at: string;
    ended_at?: string;
    ads_processed: number;
    status: 'running' | 'completed' | 'failed';
}

interface UserStats {
    total_sessions: number;
    total_ads: number;
    last_session?: string;
}

interface CianMailerConfig {
    phone: string;
    maxPages?: number;
    maxPerPage?: number;
    minPause?: number;
    maxPause?: number;
    alwaysProcess?: boolean;
    captchaApiKey?: string;
    onCodeRequest?: () => Promise<string>;
    notifier?: (event: string, payload: any) => void;
}

interface MailingResult {
    success: boolean;
    processed: number;
    error?: string;
}
```

---

## Contributing

If you want to contribute to the API:

1. Fork the repository
2. Create a feature branch
3. Add your changes
4. Update this API reference
5. Submit a pull request

---

## License

MIT License - see [LICENSE](./LICENSE) file for details.

