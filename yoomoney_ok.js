require('dotenv').config();
const express = require('express');
const fs = require('fs');
const db = require('./config/db');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios')
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// Конфигурация для бота Telegram
const TELEGRAM_BOT_API = process.env.TELEGRAM_BOT_API;

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

// Функция отправки уведомлений в Telegram (ИСПРАВЛЕНА)
const sendTelegramNotification = async (chatId, message) => {
  console.log(`📤 Отправка сообщения для ${chatId}`);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_API}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
    });
    console.log(`✅ Сообщение отправлено ${chatId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Ошибка отправки сообщения ${chatId}:`, error.response?.data || error.message);
    throw error;
  }
};

const app = express();
app.use(bodyParser.json());

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

// Функция для обновления баланса пользователя с реферальными начислениями
async function updateBalance(chatId, paymentAmount, paymentDate, operationId) {
  console.log(`🔄 Обновление баланса для ${chatId}`);
  
  try {
    const user = await getUserByChatId(chatId);
    const currentBalance = parseFloat(user.balance);
    const paymentValue = parseFloat(paymentAmount);
    const newBalance = currentBalance + paymentValue;
    
    console.log(`💰 Баланс: ${currentBalance} + ${paymentValue} = ${newBalance}`);
    console.log(`📋 Данные пользователя:`, {
      chatId: user.chatId,
      invited_by: user.invited_by,
      name: user.name
    });

    // Проверяем есть ли реферер и получаем процент из плана
    let refBonus = 0;
    let referrerId = null;
    let referrerName = '';
    let percent = 0;

    if (user.invited_by && user.invited_by !== '0' && user.invited_by !== null) {
      referrerId = user.invited_by;
      console.log(`👥 Найден реферер: ${referrerId}`);

      try {
        // Получаем процент из плана с id=2
        const planQuery = 'SELECT precent FROM plans WHERE id = 2';
        console.log(`📊 Выполняем запрос: ${planQuery}`);
        
        const planResults = await new Promise((resolve, reject) => {
          db.query(planQuery, (err, results) => {
            if (err) {
              console.error('❌ Ошибка запроса к планам:', err);
              reject(err);
            } else {
              console.log(`📊 Результат запроса планов:`, results);
              resolve(results);
            }
          });
        });

        if (planResults.length > 0) {
          percent = parseFloat(planResults[0].precent) || 0;
          refBonus = (paymentValue * percent) / 100;
          console.log(`🎯 Реферальный процент: ${percent}% от ${paymentValue} = ${refBonus.toFixed(2)} руб.`);
        } else {
          console.log('⚠️ План с id=2 не найден, реферальный процент не начислен');
        }

        // Получаем имя реферера для уведомления
        console.log(`📊 Получаем данные реферера: ${referrerId}`);
        const referrer = await getUserByChatId(referrerId);
        referrerName = referrer.name || `пользователь ${referrerId}`;
        console.log(`👤 Реферер найден: ${referrerName}`);
        
      } catch (refError) {
        console.error('❌ Ошибка получения данных реферера:', refError);
      }
    } else {
      console.log('ℹ️ Реферер не указан, бонус не начисляется');
    }

    const query = `
        UPDATE users 
        SET balance = ?, lastPaymentDate = ?, paymentAmount = ?, adminWhoBill = ?
        WHERE chatId = ?`;

    return new Promise((resolve, reject) => {
      db.query(query, [newBalance, paymentDate, paymentAmount, 'Yoomoney', chatId], async (err, results) => {
        if (err) {
          console.error('❌ Ошибка обновления баланса:', err);
          reject(err);
          return;
        }

        console.log(`✅ Основной баланс обновлен в БД`);
        
        try {
          // ✅ Уведомляем пользователя о пополнении
          const userMessage = `💰 Баланс успешно пополнен!\n💳 Сумма: ${paymentValue.toFixed(2)} руб.\n💎 Новый баланс: ${newBalance.toFixed(2)} руб.\n\nСпасибо за доверие! 😊`;
          console.log(`📤 Отправка пользователю ${chatId}`);
          await sendTelegramNotification(chatId, userMessage);
          console.log(`✅ Пользователь уведомлен`);

// ✅ Начисляем реферальный бонус если есть реферер
if (refBonus > 0 && referrerId) {
  try {
    console.log(`💰 Начисляем реферальный бонус ${refBonus.toFixed(2)} руб. пользователю ${referrerId}`);
    
    // Сначала получаем текущий ref_balance реферера для логирования
    const getRefBalanceQuery = 'SELECT ref_balance, name FROM users WHERE chatId = ?';
    db.query(getRefBalanceQuery, [referrerId], async (refBalanceErr, refBalanceResults) => {
      if (refBalanceErr || refBalanceResults.length === 0) {
        console.error('❌ Ошибка получения ref_balance реферера:', refBalanceErr);
        return;
      }

      const currentRefBalance = parseFloat(refBalanceResults[0].ref_balance) || 0;
      console.log(`📊 Текущий ref_balance реферера: ${currentRefBalance}`);

      // ПРАВИЛЬНЫЙ ЗАПРОС - добавляем к существующему балансу
      const updateRefBalanceQuery = `
        UPDATE users 
        SET ref_balance = ref_balance + ? 
        WHERE chatId = ?`;
    
      db.query(updateRefBalanceQuery, [refBonus, referrerId], (refErr, refUpdateResults) => {
        if (refErr) {
          console.error('❌ Ошибка начисления реферального бонуса:', refErr);
        } else {
          console.log(`✅ Реферальный бонус начислен! Добавлено ${refBonus.toFixed(2)} руб.`);
          
          // Получаем обновленный баланс для подтверждения
          db.query(getRefBalanceQuery, [referrerId], (checkErr, checkResults) => {
            if (!checkErr && checkResults.length > 0) {
              const updatedRefBalance = parseFloat(checkResults[0].ref_balance) || 0;
              console.log(`✅ Подтверждение: ref_balance был ${currentRefBalance}, стал ${updatedRefBalance}`);
              
              if (updatedRefBalance !== currentRefBalance + refBonus) {
                console.error(`❌ ОШИБКА: Ожидалось ${currentRefBalance + refBonus}, получено ${updatedRefBalance}`);
              }
            }
          });
          
          // Уведомляем реферера о начислении
          const refMessage = 
            `🎉 По вашей ссылке пополнен баланс!\n\n` +
            `👤 Пользователь: ${user.name || `ID ${chatId}`}\n` +
            `💳 Сумма пополнения: ${paymentValue.toFixed(2)} руб.\n` +
            `📊 Реферальный процент: ${percent}%\n` +
            `💸 Ваш бонус: ${refBonus.toFixed(2)} руб.\n` +
            `💰 Новый реферальный баланс: ${(currentRefBalance + refBonus).toFixed(2)} руб.\n\n` +
            `💡 Используйте средства для оплаты подписок в разделе "💳 Оплата"`;
          
          sendTelegramNotification(referrerId, refMessage)
            .then(() => console.log(`✅ Реферер уведомлен о бонусе`))
            .catch(err => console.error(`❌ Ошибка уведомления реферера:`, err));
        }
      });
    });
    
  } catch (bonusError) {
    console.error('❌ Ошибка в процессе начисления бонуса:', bonusError);
  }
} else {
  console.log(`ℹ️ Реферальный бонус не начислен: refBonus=${refBonus}, referrerId=${referrerId}`);
}

          // ✅ Уведомляем администраторов
          let adminMessage = 
            `📢 Новый платеж!\n` +
            `👤 Пользователь: ${chatId}\n` +
            `💳 Сумма: ${paymentValue.toFixed(2)} руб.\n` +
            `💎 Баланс: ${newBalance.toFixed(2)} руб.`;

          if (refBonus > 0) {
            adminMessage += `\n🎯 Реферальный бонус: ${refBonus.toFixed(2)} руб. (пользователю ${referrerId})`;
          } else {
            adminMessage += `\nℹ️ Реферальный бонус: не начислен`;
          }

          console.log(`📤 Отправляем уведомления администраторам: ${adminChatIds.join(', ')}`);
          
          const adminPromises = adminChatIds.map(async (adminId) => {
            try {
              await sendTelegramNotification(adminId, adminMessage);
              console.log(`✅ Администратор ${adminId} уведомлен`);
              return { success: true, adminId };
            } catch (error) {
              console.error(`⚠️ Не удалось уведомить администратора ${adminId}:`, error.message);
              return { success: false, adminId, error: error.message };
            }
          });

          await Promise.allSettled(adminPromises);
          console.log(`✅ Все уведомления администраторам обработаны`);

          console.log(`✅ Баланс обновлен для ${chatId}: ${newBalance}`);
          resolve(newBalance);
          
        } catch (notificationError) {
          console.error('❌ Ошибка уведомлений:', notificationError.message);
          // Все равно завершаем успешно, т.к. баланс обновлен
          resolve(newBalance);
        }
      });
    });
  } catch (error) {
    console.error('❌ Ошибка updateBalance:', error);
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

app.set('trust proxy', true);

// POST для приема платежей
app.post('/pay/', async (req, res) => {
    const data = req.body;

    console.log('🔔 Получено тело:', data);

const ip =
  req.headers['x-forwarded-for']?.split(',')[0].trim() ||
  req.headers['x-real-ip'] ||
  req.ip ||
  req.connection.remoteAddress;

const sql = `
    INSERT INTO yoomoney (
        notification_type, bill_id, amount, codepro, withdraw_amount, unaccepted,
        label, datetime, sender, sha1_hash, operation_label, operation_id, currency, ip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const values = [
    data.notification_type || null,
    data.bill_id || null,
    data.amount || null,
    data.codepro || null,
    data.withdraw_amount || null,
    data.unaccepted || null,
    data.label || null,
    data.datetime || null,
    data.sender || null,
    data.sha1_hash || null,
    data.operation_label || null,
    data.operation_id || null,
    data.currency || null,
    ip
];

db.query(sql, values, (err) => {
    if (err) console.error('Ошибка записи в таблицу yoomoney:', err);
    else console.log('✅ Уведомление YooMoney записано в БД');
});

    try {
        // Логируем в файл
        const logMessage = `${new Date().toISOString()} - Получен платеж: ${JSON.stringify(data)}\n`;

        // ✅ Проверка тестового уведомления
        if (data.operation_id === 'test-notification') {
            console.log('🎯 Обработка тестового уведомления');
            
            // Уведомляем всех администраторов о тестовом уведомлении
            const testMessage = '✅ Получено тестовое уведомление от YooMoney';
            const adminPromises = adminChatIds.map(adminId => 
                sendTelegramNotification(adminId, testMessage)
            );
            await Promise.allSettled(adminPromises);
            
            console.log('✅ Тестовое уведомление обработано, отправляем 200 OK');
            return res.status(200).send('Тестовое уведомление обработано');
        }

        // ✅ Проверяем обязательные поля для реального платежа
        if (!data.label || !data.amount || !data.operation_id) {
            const errorMsg = `❌ Недостаточно данных в уведомлении: label=${data.label}, amount=${data.amount}, operation_id=${data.operation_id}`;
            console.error(errorMsg);
            
            // Уведомляем админов об ошибке
            const adminPromises = adminChatIds.map(adminId => 
                sendTelegramNotification(adminId, errorMsg)
            );
            await Promise.allSettled(adminPromises);
            
            console.log('❌ Отправляем 400 из-за недостатка данных');
            return res.status(400).send('Недостаточно данных');
        }

        const chatId = data.label.toString();
        const paymentAmount = data.withdraw_amount || data.amount;
        const operationId = data.operation_id;
        const paymentDate = formatDateForMySQL(data.datetime || new Date().toISOString());

        console.log(`🔄 Обработка платежа: chatId=${chatId}, amount=${paymentAmount}, operationId=${operationId}`);

        // Проверяем существование пользователя
        try {
            await getUserByChatId(chatId);
            console.log(`✅ Пользователь ${chatId} найден`);
        } catch (error) {
            const errorMsg = `❌ Пользователь с chatId=${chatId} не найден в базе`;
            console.error(errorMsg);
            
            const adminPromises = adminChatIds.map(adminId => 
                sendTelegramNotification(adminId, errorMsg)
            );
            await Promise.allSettled(adminPromises);
            
            console.log('❌ Отправляем 404 - пользователь не найден');
            return res.status(404).send('Пользователь не найден');
        }

        // Обновляем баланс
        await updateBalance(chatId, paymentAmount, paymentDate, operationId);

        console.log(`✅ Платеж успешно обработан: ${operationId}, отправляем 200 OK`);
        res.status(200).send('OK');

    } catch (err) {
        console.error('❌ Критическая ошибка обработки платежа:', err);
        
        // Уведомляем админов о критической ошибке
        const errorMsg = `❌ Критическая ошибка при обработке платежа: ${err.message}`;
        const adminPromises = adminChatIds.map(adminId => 
            sendTelegramNotification(adminId, errorMsg)
        );
        await Promise.allSettled(adminPromises);
        
        console.log('❌ Отправляем 500 - ошибка сервера');
        res.status(500).send('Ошибка сервера');
    }
});

// Запуск сервера
const port = 3002;
app.listen(port, () => {
    console.log(`🚀 API сервер работает на порту ${port}`);
    console.log(`📝 Логи платежей записываются в payment_notifications.log`);
});

// Обновляем список админов каждые 5 минут
cron.schedule('*/5 * * * *', loadAdminChatIds);