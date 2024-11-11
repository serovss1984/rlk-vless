require('dotenv').config();
const db = require('./config/db'); // Подключение к базе данных
const moment = require('moment'); // Для работы с датами
const axios = require('axios'); // Для отправки запросов в Telegram
const cron = require('node-cron');

// Конфигурация для бота Telegram
const TELEGRAM_BOT_API = process.env.TELEGRAM_BOT_API;
const TELEGRAM_NOTIFICATION_TIME = process.env.TELEGRAM_NOTIFICATION_TIME || '09:00';

// Функция отправки уведомлений в Telegram
const sendTelegramNotification = (chatId, message) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_API}/sendMessage`;

  axios.post(url, {
    chat_id: chatId,
    text: message,
  })
  .then(response => {
    console.log('Уведомление отправлено:', response.data);
  })
  .catch(error => {
    console.error('Ошибка отправки уведомления:', error);
  });
};

// Функция для почасового списания абонентской платы
const chargeUsersHourly = () => {
  const currentDate = moment().format('YYYY-MM-DD HH:mm:ss');

  db.query('SELECT * FROM users WHERE balance > 0', (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err);
      return;
    }

    users.forEach(user => {
      db.query('SELECT * FROM plans WHERE id = ?', [user.plan_id], (err, plan) => {
        if (err) {
          console.error('Ошибка получения тарифа:', err);
          return;
        }

        const hourlyRate = parseFloat(plan[0].price) / (30 * 24); // Почасовая стоимость тарифа
        const balance = parseFloat(user.balance);

        if (balance >= hourlyRate) {
          const newBalance = balance - hourlyRate;

          db.query('UPDATE users SET balance = ?, lastBillDate = ? WHERE chatId = ?', [newBalance, currentDate, user.chatId], (err) => {
            if (err) {
              console.error(`Ошибка обновления ${user.chatId}:`, err);
              return;
            }
            console.log(`Списание ${user.chatId}, новый баланс: ${newBalance}, дата: ${currentDate}`);
          });
        } else {
          db.query('UPDATE users SET locked = 1, lockedDate = ? WHERE chatId = ?', [currentDate, user.chatId], (err) => {
            if (err) {
              console.error(`Ошибка блокировки ${user.chatId}:`, err);
              return;
            }
            console.log(`Блокировка ${user.chatId}`);
            // sendTelegramNotification(user.chatId, 'Ваш баланс истек, аккаунт заблокирован. Пополните счет для восстановления доступа.');
          });
        }
      });
    });
  });
};

// Функция для отправки ежедневных уведомлений блокированным пользователям
const sendDailyNotifications = () => {
  db.query('SELECT * FROM users WHERE locked = 1 AND lastNotificationDate != ?', [moment().format('YYYY-MM-DD')], (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей для уведомлений:', err);
      return;
    }

    users.forEach(user => {
      //sendTelegramNotification(user.chatId, 'Ваш аккаунт заблокирован из-за недостаточного баланса. Пополните счет для восстановления доступа.');
      console.log(`Уведомление ${user.chatId}`);
      
      db.query('UPDATE users SET lastNotificationDate = ? WHERE id = ?', [moment().format('YYYY-MM-DD'), user.id], (err) => {
        if (err) {
          console.error('Ошибка обновления даты последнего уведомления:', err);
        }
      });
    });
  });
};

// Задачи cron: списание каждый час и уведомления каждый день
cron.schedule('0 * * * *', chargeUsersHourly); // Запуск каждый час в 00 минут
cron.schedule(`0 ${TELEGRAM_NOTIFICATION_TIME.split(':')[1]} ${TELEGRAM_NOTIFICATION_TIME.split(':')[0]} * * *`, sendDailyNotifications);

module.exports = { chargeUsersHourly, sendTelegramNotification };

chargeUsersHourly();