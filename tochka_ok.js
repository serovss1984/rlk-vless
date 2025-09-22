const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const db = require('./config/db');
const fs = require('fs');
const path = require('path');

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
app.use(bodyParser.text({ type: '*/*' }));

let publicKeyPem;

async function loadPublicKey() {
  try {
    const res = await axios.get('https://enter.tochka.com/doc/openapi/static/keys/public');
    publicKeyPem = jwkToPem(res.data);
    console.log('✅ Публичный ключ загружен и конвертирован в PEM');
  } catch (error) {
    console.error('❌ Ошибка загрузки публичного ключа:', error.message);
  }
}

// Функция для безопасного чтения JSON файла
function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
      return [];
    }
    
    return JSON.parse(content);
  } catch (error) {
    console.error('Ошибка чтения JSON файла:', error.message);
    return [];
  }
}

// Функция для безопасной записи в JSON файл
function writeJsonFileSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Ошибка записи в JSON файл:', error.message);
  }
}

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

async function updateBalance(chatId, paymentAmount, paymentDate) {
    try {
        const user = await getUserByChatId(chatId);
        const newBalance = parseFloat(user.balance) + parseFloat(paymentAmount);

        const query = `
            UPDATE users 
            SET balance = ?, lastPaymentDate = ?, paymentAmount = ?, adminWhoBill = ?
            WHERE chatId = ?`;

        return new Promise((resolve, reject) => {
            db.query(query, [newBalance, paymentDate, paymentAmount, 'Tochka', chatId], (err) => {
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
    } catch (error) {
        console.error('Ошибка в updateBalance:', error.message);
        throw error;
    }
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

// GET для проверки
app.get('/payok/', (req, res) => {
    res.send('Платеж принят');
});

app.post('/payok', async (req, res) => {
  const token = req.body;

  try {
    const decoded = jwt.verify(token, publicKeyPem, { algorithms: ['RS256'] });
//    console.log('Полученные данные:', JSON.stringify(decoded, null, 2));

    if (decoded.webhookType === 'incomingSbpPayment') {
      const logFile = path.join(__dirname, 'incoming_sbp.json');

      const entry = {
        timestamp: new Date().toISOString(),
        amount: decoded.amount,
        purpose: decoded.purpose,
        operationId: decoded.operationId,
        payerName: decoded.payerName,
        payerMobileNumber: decoded.payerMobileNumber
      };

      // Безопасное чтение и запись JSON
      const logs = readJsonFileSafe(logFile);
      logs.push(entry);
      writeJsonFileSafe(logFile, logs);

      console.log('💾 incomingSbpPayment сохранён:', entry);

      // Получаем данные из decoded
      const chatId = decoded.purpose; // chatId в поле purpose
      const paymentAmount = decoded.amount;
      const paymentDate = formatDateForMySQL(new Date().toISOString());

      await updateBalance(chatId, paymentAmount, paymentDate);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    res.sendStatus(400);
  }
});

// Создаем пустой JSON файл при запуске, если его нет
const logFile = path.join(__dirname, 'incoming_sbp.json');
if (!fs.existsSync(logFile)) {
  writeJsonFileSafe(logFile, []);
}

loadPublicKey().then(() => {
  app.listen(3300, () => console.log('Webhook сервер слушает порт 3300'));
}).catch(error => {
  console.error('❌ Ошибка инициализации сервера:', error.message);
});