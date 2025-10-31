require('dotenv').config();
const db = require('./config/db'); // Подключение к базе данных
const moment = require('moment'); // Для работы с датами
const axios = require('axios'); // Для отправки запросов в Telegram
const cron = require('node-cron');

// Конфигурация для бота Telegram
const TELEGRAM_BOT_API = process.env.TELEGRAM_BOT_API;
const TELEGRAM_NOTIFICATION_TIME = process.env.TELEGRAM_NOTIFICATION_TIME || '12:00';

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

// Функция отправки уведомлений в Telegram
const sendTelegramNotification = async (chatId, message) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_API}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
    });
    console.log(`✅ Уведомление отправлено ${chatId}`);
  } catch (error) {
    console.error(`❌ Ошибка отправки уведомления ${chatId}:`, error.response?.data || error.message);
  }
};

// Функция отправки уведомлений всем администраторам
const sendAdminNotifications = async (message) => {
  if (adminChatIds.length === 0) {
    console.log('⚠️ Нет администраторов для уведомления');
    return;
  }

  console.log(`📤 Отправка уведомлений администраторам: ${adminChatIds.join(', ')}`);
  
  const adminPromises = adminChatIds.map(async (adminId) => {
    try {
      await sendTelegramNotification(adminId, message);
      console.log(`✅ Администратор ${adminId} уведомлен`);
    } catch (error) {
      console.error(`⚠️ Не удалось уведомить администратора ${adminId}`);
    }
  });

  await Promise.allSettled(adminPromises);
};

// Функция для почасового списания абонентской платы
const chargeUsersHourly = async () => {
  const currentDate = moment().format('YYYY-MM-DD HH:mm:ss');
  
  db.query('SELECT * FROM users WHERE locked = 0', async (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err);
      return;
    }

    if (!users || users.length === 0) {
      console.log('ℹ️ Нет пользователей для списания.');
      return;
    }

    console.log(`🔄 Начинаем списание для ${users.length} пользователей`);

    for (const user of users) {
      if (!user) {
        console.error("Ошибка: данные пользователя отсутствуют.");
        continue;
      }

      try {
        await new Promise((resolve, reject) => {
          db.query('SELECT * FROM plans WHERE id = ?', [user.plan_id], async (err, plan) => {
            if (err) {
              console.error('Ошибка получения тарифа:', err);
              reject(err);
              return;
            }

            if (!plan || plan.length === 0) {
              console.error(`❌ Тариф для пользователя ${user.chatId} не найден.`);
              resolve();
              return;
            }

            const hourlyRate = calculateHourlyRate(plan[0].price, user);
            const balance = parseFloat(user.balance);

            if (balance >= hourlyRate) {
              const newBalance = balance - hourlyRate;

              db.query('UPDATE users SET balance = ?, lastBillDate = ? WHERE chatId = ?', 
                [newBalance, currentDate, user.chatId], 
                async (err) => {
                  if (err) {
                    console.error(`❌ Ошибка обновления ${user.chatId}:`, err);
                    reject(err);
                    return;
                  }
                  console.log(`✅ Списание ${user.chatId}, сумма: ${hourlyRate.toFixed(4)}, новый баланс: ${newBalance.toFixed(2)}`);
                  resolve();
                });
            } else {
              // Блокировка пользователя
              db.query('UPDATE users SET locked = 1, lockedDate = ? WHERE chatId = ?', 
                [currentDate, user.chatId], 
                async (err) => {
                  if (err) {
                    console.error(`❌ Ошибка блокировки ${user.chatId}:`, err);
                    reject(err);
                    return;
                  }

                  // Отключаем клиентов
                  try {
                    await axios.put(`http://localhost:3332/client/${user.chatId}-1/disable`);
                    console.log(`🔒 Отключён клиент ${user.chatId}-1`);
                  } catch (error) {
                    console.error(`❌ Ошибка при отключении клиента ${user.chatId}-1:`, error.message);
                  }

                  try {
                    await axios.put(`http://localhost:3332/client/${user.chatId}-5/disable`);
                    console.log(`🔒 Отключён клиент ${user.chatId}-5`);
                  } catch (error) {
                    console.error(`❌ Ошибка при отключении клиента ${user.chatId}-5:`, error.message);
                  }

                  console.log(`🔒 Блокировка ${user.chatId}`);
                  
                  // Уведомления
                  await sendTelegramNotification(
                    user.chatId, 
                    '❌ Ваш аккаунт заблокирован из-за недостаточного баланса. Пополните счет для восстановления доступа.'
                  );
                  
                  await sendAdminNotifications(
                    `🔒 Аккаунт ${user.chatId} заблокирован. Баланс: ${balance.toFixed(2)}, требуется: ${hourlyRate.toFixed(4)}`
                  );
                  
                  resolve();
                });
            }
          });
        });
      } catch (error) {
        console.error(`❌ Ошибка обработки пользователя ${user.chatId}:`, error);
      }
    }
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
  const hourlyRate = baseHourlyRate * filledFieldsCount;
  console.log(`💰 Расчет для ${user.chatId}: база=${baseHourlyRate.toFixed(4)}, множитель=${filledFieldsCount}, итого=${hourlyRate.toFixed(4)}`);
  
  return hourlyRate;
};

// Функция разблокировки пользователей
const UnlockUsers = async () => {
  const currentDate = moment().format('YYYY-MM-DD HH:mm:ss');
  
  db.query('SELECT * FROM users WHERE locked = 1', async (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err);
      return;
    }

    if (!users || users.length === 0) {
      console.log('ℹ️ Нет пользователей для разблокировки.');
      return;
    }

    console.log(`🔄 Проверка разблокировки для ${users.length} пользователей`);

    for (const user of users) {
      if (!user) {
        console.error("Ошибка: данные пользователя отсутствуют.");
        continue;
      }

      try {
        await new Promise((resolve, reject) => {
          db.query('SELECT * FROM plans WHERE id = ?', [user.plan_id], async (err, plan) => {
            if (err) {
              console.error('Ошибка получения тарифа:', err);
              reject(err);
              return;
            }

            if (!plan || plan.length === 0) {
              console.error(`❌ Тариф для пользователя ${user.chatId} не найден.`);
              resolve();
              return;
            }

            const hourlyRate = calculateHourlyRate(plan[0].price, user);
            const balance = parseFloat(user.balance);

            if (balance >= hourlyRate) {
              db.query('UPDATE users SET locked = 0 WHERE chatId = ?', [user.chatId], async (err) => {
                if (err) {
                  console.error(`❌ Ошибка разблокировки ${user.chatId}:`, err);
                  reject(err);
                  return;
                }

                // Включаем клиентов
                try {
                  await axios.put(`http://localhost:3332/client/${user.chatId}-1/enable`);
                  console.log(`🔓 Включён клиент ${user.chatId}-1`);
                } catch (error) {
                  console.error(`❌ Ошибка при включении клиента ${user.chatId}-1:`, error.message);
                }

                try {
                  await axios.put(`http://localhost:3332/client/${user.chatId}-5/enable`);
                  console.log(`🔓 Включён клиент ${user.chatId}-5`);
                } catch (error) {
                  console.error(`❌ Ошибка при включении клиента ${user.chatId}-5:`, error.message);
                }

                console.log(`🔓 Разблокировка ${user.chatId}`);
                
                // Уведомления
                await sendTelegramNotification(
                  user.chatId, 
                  '✅ Ваш доступ восстановлен! Баланс пополнен.'
                );
                
                await sendAdminNotifications(
                  `🔓 Аккаунт ${user.chatId} разблокирован. Баланс: ${balance.toFixed(2)}`
                );
                
                resolve();
              });
            } else {
              console.log(`ℹ️ Недостаточно средств для разблокировки ${user.chatId}: ${balance.toFixed(2)} < ${hourlyRate.toFixed(4)}`);
              resolve();
            }
          });
        });
      } catch (error) {
        console.error(`❌ Ошибка обработки пользователя ${user.chatId}:`, error);
      }
    }
  });
};

// Функция для отправки ежедневных уведомлений блокированным пользователям
const sendDailyNotifications = async () => {
  db.query('SELECT * FROM users WHERE locked = 1', async (err, users) => {
    if (err) {
      console.error('Ошибка получения пользователей для уведомлений:', err);
      return;
    }
    
    if (users.length === 0) {
      console.log('ℹ️ Нет заблокированных пользователей для уведомлений');
      return;
    }

    console.log(`📨 Отправка ежедневных уведомлений для ${users.length} пользователей`);
    
    for (const user of users) {
      await sendTelegramNotification(
        user.chatId, 
        '💡 Ваш аккаунт заблокирован из-за недостаточного баланса. Пополните счет для восстановления доступа.'
      );
    }
    
    await sendAdminNotifications(
      `📊 Статистика: ${users.length} заблокированных пользователей`
    );
  });
};

// Задачи cron: списание каждый час и уведомления каждый день
cron.schedule('0 * * * *', chargeUsersHourly);
cron.schedule('*/5 * * * *', UnlockUsers);
cron.schedule(`0 ${TELEGRAM_NOTIFICATION_TIME.split(':')[1]} ${TELEGRAM_NOTIFICATION_TIME.split(':')[0]} * * *`, sendDailyNotifications);

// Обновляем список админов каждые 5 минут
cron.schedule('*/5 * * * *', loadAdminChatIds);

console.log('🚀 Биллинг система запущена');
console.log('⏰ Расписание:');
console.log('   - Списание каждый час (0 * * * *)');
console.log('   - Проверка разблокировки каждые 5 минут');
console.log('   - Ежедневные уведомления в', TELEGRAM_NOTIFICATION_TIME);

module.exports = { 
  chargeUsersHourly, 
  sendTelegramNotification, 
  UnlockUsers, 
  sendAdminNotifications,
  loadAdminChatIds
};

//chargeUsersHourly();