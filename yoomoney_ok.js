require('dotenv').config();
const express = require('express');
const fs = require('fs');
const db = require('./config/db');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios')
const TelegramBot = require('node-telegram-bot-api');

// Конфигурация для бота Telegram
const TELEGRAM_BOT_API = process.env.TELEGRAM_BOT_API;

// Функция отправки уведомлений в Telegram
const sendTelegramNotification = (chatId, message) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_API}/sendMessage`;

  axios.post(url, {
    chat_id: chatId,
    text: message,
  })
};

const app = express();
app.use(bodyParser.json());

// Это должно быть ДО всех роутов
app.use(express.urlencoded({ extended: false })); // парсинг form-urlencoded
app.use(express.json()); // если вдруг будут JSON

// Секрет из .env
const NOTIFICATION_SECRET = process.env.NOTIFICATION_SECRET;

// GET для проверки
app.get('/pay/', (req, res) => {
    res.send('Платеж принят');
});

// Функция для получения пользователя по chatId
async function getUserByChatId(chatId) {
    const query = 'SELECT * FROM users WHERE chatId = ?';
    return new Promise((resolve, reject) => {
        db.query(query, [chatId], (err, results) => {
            if (err) {
                console.error('Ошибка выполнения запроса к базе данных:', err);
                reject(err);
            } else if (results.length > 0) {
                resolve(results[0]);
            } else {
                reject(new Error('Пользователь не найден'));
            }
        });
    });
}

// Функция для обновления баланса пользователя
async function updateBalance(chatId, paymentAmount, paymentDate) {
    const user = await getUserByChatId(chatId);

    const newBalance = parseFloat(user.balance) + parseFloat(paymentAmount);

    const query = `
        UPDATE users 
        SET balance = ?, lastPaymentDate = ?, paymentAmount = ?, adminWhoBill = ?
        WHERE chatId = ?`;

    return new Promise((resolve, reject) => {
        db.query(query, [newBalance, paymentDate, paymentAmount, 'Yoomoney', chatId], (err) => {
            if (err) {
                console.error('Ошибка обновления баланса:', err);
                reject(err);
            } else {
                const message = `Ваш баланс успешно обновлен! Новая сумма: ${newBalance.toFixed(2)}. Сумма вашего платежа: ${parseFloat(paymentAmount).toFixed(2)}. Спасибо за пополнение!`;

                    sendTelegramNotification(chatId, message);
                    sendTelegramNotification(5906119921, message);

                console.log(message);
                resolve(newBalance);
            }
        });
    });
}

function formatDateForMySQL(isoString) {
    const date = new Date(isoString);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// POST для приема платежей
app.post('/pay/', async (req, res) => {
    const data = req.body;

    console.log('Получено тело:', data);

    try {
        // Проверка подписи
        const signString = [
            data.notification_type,
            data.operation_id,
            data.amount,
            data.currency,
            data.datetime,
            data.sender,
            data.codepro,
            NOTIFICATION_SECRET,
            data.label
        ].join('&');

        const hash = crypto.createHash('sha1').update(signString, 'utf8').digest('hex');

        if (hash.toLowerCase() !== data.sha1_hash.toLowerCase()) {
            console.error('❌ Неверная подпись платежа!', { expected: hash, got: data.sha1_hash });
            return res.status(400).send('Ошибка подписи');
        }

        // Логируем в файл
        const logMessage = `${new Date().toISOString()} - Валидный платеж: ${JSON.stringify(data)}\n`;
        fs.appendFile('payment_notifications.log', logMessage, (err) => {
            if (err) console.error('Ошибка записи в файл:', err);
        });

        // Обновляем баланс пользователя
        const chatId = data.label; // предполагаем, что label = chatId
        const paymentAmount = data.withdraw_amount;
        const paymentDate = formatDateForMySQL(data.datetime);

        await updateBalance(chatId, paymentAmount, paymentDate);

        res.status(200).send('OK');
    } catch (err) {
        console.error('Ошибка обработки платежа:', err);
        res.status(500).send('Ошибка сервера');
    }
});

// Запуск сервера
const port = 3002;
app.listen(port, () => {
    console.log(`API сервер работает на порту ${port}`);
});