const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const db = require('./config/db');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

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

let adminChatIds = [];

// Загрузка Telegram ID администраторов
const loadAdminChatIds = () => {
  db.query('SELECT chatId FROM users WHERE admin = 1', (err, results) => {
    if (err) {
      console.error('Ошибка загрузки администраторов:', err);
      return;
    }

    adminChatIds = results.map(row => row.chatId.toString());
    console.log(`Администраторы загружены: ${adminChatIds.join(', ')}`);
  });
};

// Загружаем админов при старте
loadAdminChatIds();

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

// Функция для обновления баланса пользователя с реферальными начислениями
async function updateBalance(chatId, paymentAmount, paymentDate, operationId) {
  console.log(`🔄 Обновление баланса для ${chatId}`);
  
  try {
    const user = await getUserByChatId(chatId);
    const currentBalance = parseFloat(user.balance) || 0;
    const paymentValue = parseFloat(paymentAmount);
    const newBalance = currentBalance + paymentValue;

    console.log(`💰 Баланс: ${currentBalance} + ${paymentValue} = ${newBalance}`);
    console.log(`📋 Данные пользователя:`, {
      chatId: user.chatId,
      invited_by: user.invited_by,
      name: user.name
    });

    // --- Проверяем есть ли реферер ---
    let refBonus = 0;
    let referrerId = null;
    let referrerName = '';
    let percent = 0;

    if (user.invited_by && user.invited_by !== '0' && user.invited_by !== null) {
      referrerId = user.invited_by;
      console.log(`👥 Найден реферер: ${referrerId}`);

      try {
        // Получаем процент из таблицы plans (по plan_id пользователя)
        const planId = user.plan_id || 2; // fallback = 2 если нет plan_id
        const planQuery = 'SELECT precent FROM plans WHERE id = ?';

        const planResults = await new Promise((resolve, reject) => {
          db.query(planQuery, [planId], (err, results) => {
            if (err) return reject(err);
            resolve(results);
          });
        });

        if (planResults.length > 0) {
          percent = parseFloat(planResults[0].precent) || 0;
          refBonus = (paymentValue * percent) / 100;
          console.log(`🎯 Реферальный процент: ${percent}% от ${paymentValue} = ${refBonus.toFixed(2)} руб.`);
        } else {
          console.log(`⚠️ План с id=${planId} не найден, бонус не начисляется`);
        }

        const referrer = await getUserByChatId(referrerId);
        referrerName = referrer.name || `пользователь ${referrerId}`;
      } catch (refError) {
        console.error('❌ Ошибка получения данных реферера:', refError);
      }
    } else {
      console.log('ℹ️ Реферер не указан, бонус не начисляется');
    }

    // --- Обновляем основной баланс ---
    const updateQuery = `
        UPDATE users 
        SET balance = ?, lastPaymentDate = ?, paymentAmount = ?, adminWhoBill = ?
        WHERE chatId = ?`;

    await new Promise((resolve, reject) => {
      db.query(updateQuery, [newBalance, paymentDate, paymentAmount, 'Yoomoney', chatId], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    console.log(`✅ Основной баланс обновлен в БД`);

    // --- Уведомляем пользователя ---
    const userMessage = `💰 Баланс успешно пополнен!\n💳 Сумма: ${paymentValue.toFixed(2)} руб.\n💎 Новый баланс: ${newBalance.toFixed(2)} руб.\n\nСпасибо за доверие! 😊`;
    await sendTelegramNotification(chatId, userMessage);

    // --- Начисляем бонус, если есть ---
    if (refBonus > 0 && referrerId) {
      console.log(`💰 Начисляем реферальный бонус ${refBonus.toFixed(2)} руб. пользователю ${referrerId}`);

      await new Promise((resolve, reject) => {
        db.query(
          'UPDATE users SET ref_balance = ref_balance + ? WHERE chatId = ?',
          [refBonus, referrerId],
          (err) => (err ? reject(err) : resolve())
        );
      });

      const refMessage = 
        `🎉 По вашей ссылке пополнен баланс!\n\n` +
        `👤 Пользователь: ${user.name || `ID ${chatId}`}\n` +
        `💳 Сумма пополнения: ${paymentValue.toFixed(2)} руб.\n` +
        `📊 Реферальный процент: ${percent}%\n` +
        `💸 Ваш бонус: ${refBonus.toFixed(2)} руб.\n\n` +
        `💡 Средства доступны в разделе "💳 Оплата"`;

      await sendTelegramNotification(referrerId, refMessage);
      console.log(`✅ Реферер уведомлён о бонусе`);
    }

    // --- Уведомляем всех администраторов ---
    let adminMessage = 
      `📢 Новый платеж!\n` +
      `👤 Пользователь: ${user.name || chatId}\n` +
      `💳 Сумма: ${paymentValue.toFixed(2)} руб.\n` +
      `💎 Баланс: ${newBalance.toFixed(2)} руб.\n` +
      `🆔 Операция: ${operationId}`;

    if (refBonus > 0) {
      adminMessage += `\n🎯 Реферальный бонус: ${refBonus.toFixed(2)} руб. → ${referrerName} (${referrerId})`;
    } else {
      adminMessage += `\nℹ️ Реферальный бонус: не начислен`;
    }

    console.log(`📤 Уведомляем администраторов (${adminChatIds.join(', ')})...`);
    const adminPromises = adminChatIds.map(adminId => 
      sendTelegramNotification(adminId, adminMessage)
    );
    await Promise.allSettled(adminPromises);
    console.log(`✅ Все администраторы уведомлены`);

    console.log(`✅ Баланс обновлён для ${chatId}: ${newBalance.toFixed(2)} ₽`);
    return newBalance;

  } catch (error) {
    console.error('❌ Ошибка в updateBalance:', error);
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

// Обновляем список админов каждые 5 минут
cron.schedule('*/5 * * * *', loadAdminChatIds);