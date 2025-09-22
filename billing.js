require('dotenv').config();
const db = require('./config/db'); // Подключение к базе данных
const moment = require('moment'); // Для работы с датами
const axios = require('axios'); // Для отправки запросов в Telegram
const cron = require('node-cron');

// Конфигурация для бота Telegram
const TELEGRAM_BOT_API = process.env.TELEGRAM_BOT_API;
const TELEGRAM_NOTIFICATION_TIME = process.env.TELEGRAM_NOTIFICATION_TIME || '12:00';

// Функция отправки уведомлений в Telegram
const sendTelegramNotification = (chatId, message) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_API}/sendMessage`;

  axios.post(url, {
    chat_id: chatId,
    text: message,
  })
};

// Функция для почасового списания абонентской платы
const chargeUsersHourly = () => {
  const currentDate = moment().format('YYYY-MM-DD HH:mm:ss');
  db.query('SELECT * FROM users WHERE locked = 0', (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err);
      return;
    }

    if (!users || users.length === 0) {
//      console.log('Нет пользователей для списания.');
      return;
    }

    users.forEach(user => {
      if (!user) {
        console.error("Ошибка: данные пользователя отсутствуют.");
        return;
      }

      db.query('SELECT * FROM plans WHERE id = ?', [user.plan_id], (err, plan) => {
        if (err) {
          console.error('Ошибка получения тарифа:', err);
          return;
        }

        if (!plan || plan.length === 0) {
          console.error(`Тариф для пользователя ${user.chatId} не найден.`);
          return;
        }

        const hourlyRate = calculateHourlyRate(plan[0].price, user);
        const balance = parseFloat(user.balance);

        if (balance >= hourlyRate) {
          const newBalance = balance - hourlyRate;

          db.query('UPDATE users SET balance = ?, lastBillDate = ? WHERE chatId = ?', [newBalance, currentDate, user.chatId], (err) => {
            if (err) {
              console.error(`Ошибка обновления ${user.chatId}:`, err);
              return;
            }
            console.log(`Списание ${user.chatId}, сумма: ${hourlyRate}, новый баланс: ${newBalance}, дата: ${currentDate}`);
          });
        } else {
          db.query('UPDATE users SET locked = 1, lockedDate = ? WHERE chatId = ?', [currentDate, user.chatId], (err) => {
            if (err) {
              console.error(`Ошибка блокировки ${user.chatId}:`, err);
              return;
            }

            axios.put(`http://localhost:3332/client/${user.chatId}-1/disable`)
              .then(() => {
//              console.log(`Отключён клиент ${user.chatId}-1`);
            })
            .catch(error => {
              console.error(`Ошибка при отключении клиента ${user.chatId}-1:`, error.message);
            });

            axios.put(`http://localhost:3332/client/${user.chatId}-5/disable`)
              .then(() => {
              console.log(`Отключён клиент ${user.chatId}-5`);
            })
            .catch(error => {
              console.error(`Ошибка при отключении клиента ${user.chatId}-5:`, error.message);
            });

            console.log(`Блокировка ${user.chatId}`);
            sendTelegramNotification(user.chatId, 'Ваш аккаунт заблокирован. Пополните счет для восстановления доступа.');
            sendTelegramNotification(5906119921, `Аккаунт ${user.chatId} заблокирован.`);
          });
        }
      });
    });
  });
};

// Функция для расчета почасовой стоимости
const calculateHourlyRate = (planPrice, user) => {
  // Почасовая стоимость базового тарифа
  const baseHourlyRate = parseFloat(planPrice) / (30 * 24);

  if (!user) {
    console.error("Ошибка: данные пользователя отсутствуют.");
    return 0;
  }

  // Массив полей vless
  const vlessFields = ['NL', 'GE'];
  let filledFieldsCount = 0;

  vlessFields.forEach(field => {
    // Увеличиваем счетчик только если значение поля не "0"
    if (user[field] !== "0") {
      filledFieldsCount++;
    }
  });

  // Итоговая почасовая стоимость
  return baseHourlyRate * filledFieldsCount;
};

// Функция разблокировки пользователей
const UnlockUsers = () => {
  const currentDate = moment().format('YYYY-MM-DD HH:mm:ss');
  db.query('SELECT * FROM users WHERE locked = 1', (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err);
      return;
    }

//    if (!users || users.length === 0) {
//      console.log('Нет пользователей для разблокировки.');
//      return;
//    }

    users.forEach(user => {
      if (!user) {
        console.error("Ошибка: данные пользователя отсутствуют.");
        return;
      }

      db.query('SELECT * FROM plans WHERE id = ?', [user.plan_id], (err, plan) => {
        if (err) {
          console.error('Ошибка получения тарифа:', err);
          return;
        }

        if (!plan || plan.length === 0) {
          console.error(`Тариф для пользователя ${user.chatId} не найден.`);
          return;
        }

        const hourlyRate = calculateHourlyRate(plan[0].price, user);
        const balance = parseFloat(user.balance);

        if (balance >= hourlyRate) {
          db.query('UPDATE users SET locked = 0 WHERE chatId = ?', [user.chatId], (err) => {
            if (err) {
              console.error(`Ошибка разблокировки ${user.chatId}:`, err);
              return;
            }

            axios.put(`http://localhost:3332/client/${user.chatId}-1/enable`)
              .then(() => {
                console.log(`Включён клиент ${user.chatId}-1`);
            })
              .catch(error => {
                console.error(`Ошибка при включении клиента ${user.chatId}-1:`, error.message);
            });

            axios.put(`http://localhost:3332/client/${user.chatId}-5/enable`)
              .then(() => {
                console.log(`Включён клиент ${user.chatId}-5`);
            })
              .catch(error => {
                console.error(`Ошибка при включении клиента ${user.chatId}-5:`, error.message);
            });

            sendTelegramNotification(user.chatId, 'Ваш доступ восстановлен.');
            sendTelegramNotification(5906119921, `Аккаунт ${user.chatId} разблокирован.`);
//            console.log(`Разблокировка ${user.chatId}`);
          });
        } else {
//          console.log(`Недостаточно средств для разблокировки ${user.chatId}`);
        }
      });
    });
  });
};

// Функция для отправки ежедневных уведомлений блокированным пользователям
const sendDailyNotifications = () => {
  db.query('SELECT * FROM users WHERE locked = 1', (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей для уведомлений:', err);
      return;
    }
    users.forEach(user => {
      sendTelegramNotification(user.chatId, 'Ваш аккаунт заблокирован из-за недостаточного баланса. Пополните счет для восстановления доступа.');
      sendTelegramNotification(5906119921, `Аккаунт ${user.chatId} заблокирован.`);
//      console.log(`Уведомление ${user.chatId}`);
    });
  });
};

// Задачи cron: списание каждый час и уведомления каждый день
cron.schedule('0 * * * *', chargeUsersHourly);
cron.schedule('*/5 * * * *', UnlockUsers);
cron.schedule(`0 ${TELEGRAM_NOTIFICATION_TIME.split(':')[1]} ${TELEGRAM_NOTIFICATION_TIME.split(':')[0]} * * *`, sendDailyNotifications);

//chargeUsersHourly();

module.exports = { chargeUsersHourly, sendTelegramNotification, UnlockUsers };
