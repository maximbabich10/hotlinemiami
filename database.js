/**
 * database.js
 * Модуль для работы с базой данных пользователей
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor(dbPath = './users.db') {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Ошибка подключения к БД:', err.message);
            } else {
                console.log('✅ Подключено к базе данных');
                this.initTables();
            }
        });
    }

    /**
     * Инициализация таблиц
     */
    initTables() {
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                telegram_id INTEGER PRIMARY KEY,
                phone_number TEXT NOT NULL,
                cian_login TEXT,
                cian_password TEXT,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createSessionsTable = `
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                ended_at DATETIME,
                ads_processed INTEGER DEFAULT 0,
                status TEXT DEFAULT 'running',
                FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
            )
        `;

        this.db.run(createUsersTable, (err) => {
            if (err) {
                console.error('❌ Ошибка создания таблицы users:', err.message);
            } else {
                console.log('✅ Таблица users готова');
            }
        });

        this.db.run(createSessionsTable, (err) => {
            if (err) {
                console.error('❌ Ошибка создания таблицы sessions:', err.message);
            } else {
                console.log('✅ Таблица sessions готова');
            }
        });
    }

    /**
     * Регистрация нового пользователя
     */
    registerUser(telegramId, phoneNumber, cianLogin = null, cianPassword = null) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO users (telegram_id, phone_number, cian_login, cian_password)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                    phone_number = excluded.phone_number,
                    cian_login = excluded.cian_login,
                    cian_password = excluded.cian_password,
                    updated_at = CURRENT_TIMESTAMP
            `;

            this.db.run(sql, [telegramId, phoneNumber, cianLogin, cianPassword], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        telegramId, 
                        phoneNumber,
                        changes: this.changes 
                    });
                }
            });
        });
    }

    /**
     * Получить данные пользователя
     */
    getUser(telegramId) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM users WHERE telegram_id = ? AND is_active = 1';
            
            this.db.get(sql, [telegramId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    /**
     * Обновить учетные данные CIAN
     */
    updateCianCredentials(telegramId, cianLogin, cianPassword) {
        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE users 
                SET cian_login = ?, cian_password = ?, updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ?
            `;

            this.db.run(sql, [cianLogin, cianPassword, telegramId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    /**
     * Деактивировать пользователя
     */
    deactivateUser(telegramId) {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?';
            
            this.db.run(sql, [telegramId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    /**
     * Создать новую сессию
     */
    createSession(telegramId) {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO sessions (telegram_id) VALUES (?)';
            
            this.db.run(sql, [telegramId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ sessionId: this.lastID });
                }
            });
        });
    }

    /**
     * Обновить статус сессии
     */
    updateSession(sessionId, adsProcessed, status = 'running') {
        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE sessions 
                SET ads_processed = ?, status = ?, ended_at = CASE WHEN ? != 'running' THEN CURRENT_TIMESTAMP ELSE NULL END
                WHERE id = ?
            `;
            
            this.db.run(sql, [adsProcessed, status, status, sessionId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    /**
     * Получить статистику пользователя
     */
    getUserStats(telegramId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_sessions,
                    SUM(ads_processed) as total_ads,
                    MAX(started_at) as last_session
                FROM sessions
                WHERE telegram_id = ?
            `;
            
            this.db.get(sql, [telegramId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    /**
     * Закрыть соединение с БД
     */
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('✅ Соединение с БД закрыто');
                    resolve();
                }
            });
        });
    }
}

module.exports = Database;

