const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/db');
const moment = require('moment');
const QRCode = require('qrcode');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_API, { polling: true });

// Команда /start для отображения главного меню
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

// Функция для показа главного меню с проверкой регистрации
function showMainMenu(chatId) {
  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], (err, users) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при проверке регистрации.');
      console.error('Ошибка запроса:', err);
      return;
    }

    // Если пользователя нет в базе, показываем меню с кнопкой "Регистрация"
    if (users.length === 0) {
      console.log('Пользователь не найден, показываем меню с регистрацией');

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Регистрация', callback_data: 'register' }]
          ]
        }
      };

      bot.sendMessage(chatId, 'Добро пожаловать!\nПожалуйста, зарегистрируйтесь, чтобы продолжить.', options);

    } else {
      // Если пользователь найден, показываем другое меню с приветствием и кнопками
      const user = users[0];
      console.log('Пользователь найден, показываем меню для зарегистрированного пользователя');
      console.log('Результат запроса пользователей:', users);

      // Логика для подсчета количества устройств
      const vlessFields = ['vless-1', 'vless-2', 'vless-3', 'vless-4', 'vless-5'];
      let devicesCount = 0;

      vlessFields.forEach(field => {
        if (user[field] && user[field] !== '0') {
          devicesCount++;
        }
      });

// Логика для вычисления абонентской платы (пример)
const planPrice = parseFloat(user.paymentAmount); // берем стоимость из поля paymentAmount

// Проверяем, установлен ли тариф
let hourlyRate, dailyRate, daysLeft;

if (planPrice > 0) {
  hourlyRate = planPrice / (30 * 24); // делим на количество часов в месяце
  dailyRate = planPrice / 30; // суточная абонентская плата
  daysLeft = Math.floor(user.balance / dailyRate); // вычисляем, на сколько дней хватит средств
} else {
  hourlyRate = 0;
  dailyRate = 0;
  daysLeft = Infinity; // если план бесплатный, средства "хватит на неограниченное время"
}

// Функция для морфологии "день", "дня", "дней"
function getDayWord(num) {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return 'дней';
  if (lastDigit === 1) return 'день';
  if (lastDigit >= 2 && lastDigit <= 4) return 'дня';
  return 'дней';
}

// Приветственное сообщение
const lockedStatus = user.locked === 1 ? 'Да' : 'Нет';

const daysLeftText = daysLeft === Infinity ? 'неограниченное время' : `${daysLeft} ${getDayWord(daysLeft)}`;

const welcomeText = `Добро пожаловать, ${user.name || 'пользователь'}!\n` +
      `Ваш ID: ${chatId}\n` +
      `Ваш баланс: ${Number(user.balance).toFixed(2)}\n` +
      `Количество устройств: ${devicesCount}\n` +
      `Абонентская плата: ${hourlyRate.toFixed(2)} за час\n` +
      `Средств хватит на ${daysLeftText}\n` +
      `Заблокирован: ${lockedStatus}`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Мои данные', callback_data: 'profile' }],
            [{ text: 'Мои устройства', callback_data: 'devices' }]
          ]
        }
      };

      bot.sendMessage(chatId, welcomeText, options);
    }
  });
}

// Обработчик нажатий на кнопки
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  if (action === 'profile') {
    profile(chatId);
  } else if (action === 'back_to_main') {
    showMainMenu(chatId);
  } else if (action === 'register') {
    register(chatId);
  } else if (action === 'devices') {
    devices(chatId);
  }
});

// Меню данных
function profile(chatId) {
  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], (err, users) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при получении информации.');
      return;
    }

    if (users.length > 0) {
      const user = users[0];

      const options = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Изменить имя', callback_data: 'edit_name' },
              { text: 'Изменить телефон', callback_data: 'edit_phone' }
            ],
            [{ text: 'Назад', callback_data: 'back_to_main' }]
          ]
        }
      };

      const profile = `Данные необходимы для автоматического зачисления платежа по СБП.\n\nИмя: ${user.name || 'не указано'}\nТелефон: ${user.phone || 'не указан'}\n`;
      bot.sendMessage(chatId, profile, options);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
}

// Обработчик для изменения имени и телефона
bot.on('callback_query', query => {
  const chatId = query.message.chat.id;

  if (query.data === 'edit_name') {
    bot.sendMessage(chatId, 'Введите имя в формате "Иван Иванович И":');
    bot.once('message', msg => {
      const newName = msg.text;
      db.query('UPDATE users SET name = ? WHERE chatId = ?', [newName, chatId], (err) => {
        if (err) {
          bot.sendMessage(chatId, 'Произошла ошибка при обновлении имени.');
        } else {
          const options = {
            reply_markup: {
              inline_keyboard: [[{ text: 'Назад', callback_data: 'back_to_profile' }]]
            }
          };
          bot.sendMessage(chatId, 'Имя успешно обновлено.', options);
        }
      });
    });
  }

  if (query.data === 'edit_phone') {
    bot.sendMessage(chatId, 'Введите телефон начиная с +7 или +375:');
    bot.once('message', msg => {
      const newPhone = msg.text;
      db.query('UPDATE users SET phone = ? WHERE chatId = ?', [newPhone, chatId], (err) => {
        if (err) {
          bot.sendMessage(chatId, 'Произошла ошибка при обновлении телефона.');
        } else {
          const options = {
            reply_markup: {
              inline_keyboard: [[{ text: 'Назад', callback_data: 'back_to_profile' }]]
            }
          };
          bot.sendMessage(chatId, 'Телефон успешно обновлен.', options);
        }
      });
    });
  }

  if (query.data === 'back_to_profile') {
    profile(chatId);
  }
});

// Функция регистрации
function register(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Назад', callback_data: 'back_to_main' }]
      ]
    }
  };

  // Начинаем процесс регистрации, сразу записываем данные с null
  const registrationDate = moment().format('YYYY-MM-DD HH:mm:ss');
  const lastPaymentDate = registrationDate; // Дата последнего платежа при регистрации
  const lastBillDate = registrationDate; // Дата последнего счета

  const query = `INSERT INTO users (chatId, phone, lang, name, registrationDate, lastPaymentDate, paymentAmount, balance, lastBillDate, locked, lockedDate, files, plan_id, \`vless-1\`, \`vless-2\`, \`vless-3\`, \`vless-4\`, \`vless-5\`. admin) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [chatId, null, null, null, registrationDate, lastPaymentDate, 0, 0, lastBillDate, 1, registrationDate, null, 2, 0, 0, 0, 0, 0, 0];
  
  db.query(query, values, (err) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при регистрации.');
      console.error('Ошибка при записи в базу данных:', err);
      return;
    }

    bot.sendMessage(chatId, 'Вы успешно зарегистрированы!');

    // После регистрации возвращаем пользователя в главное меню
    showMainMenu(chatId);
  });
}

function devices(chatId) {
  db.query('SELECT `vless-1`, `vless-2`, `vless-3`, `vless-4`, `vless-5` FROM users WHERE chatId = ?', [chatId], (err, results) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при получении данных устройств.');
      return;
    }

    if (results.length > 0) {
      const userDevices = results[0];
      const deviceButtons = [];

      Object.keys(userDevices).forEach((deviceKey) => {
        const deviceValue = userDevices[deviceKey];
        if (deviceValue && deviceValue !== '0') {
          deviceButtons.push([
            { text: `Посмотреть ${deviceKey}`, callback_data: `view_${deviceKey}` },
            { text: `Удалить ${deviceKey}`, callback_data: `delete_${deviceKey}` }
          ]);
        } else {
          deviceButtons.push([
            { text: `Добавить ${deviceKey}`, callback_data: `add_${deviceKey}` }
          ]);
        }
      });

      deviceButtons.push([{ text: 'Назад', callback_data: 'back_to_main' }]);

      const options = {
        reply_markup: {
          inline_keyboard: deviceButtons
        }
      };

      bot.sendMessage(chatId, 'Ваши устройства:', options);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
}

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action.startsWith('view_')) {
    const deviceKey = action.split('_')[1];

    db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], (err, results) => {
      if (err || results.length === 0) {
        bot.sendMessage(chatId, 'Произошла ошибка при получении данных устройства.');
        return;
      }

      const deviceUrl = results[0][deviceKey];
      if (!deviceUrl || deviceUrl === '0') {
        bot.sendMessage(chatId, 'Данные для устройства не найдены.');
        return;
      }

      QRCode.toDataURL(deviceUrl, (err, qrCodeDataUrl) => {
        if (err) {
          bot.sendMessage(chatId, 'Ошибка при генерации QR-кода.');
          return;
        }

        // Извлекаем данные после 'base64,' и создаем буфер
        const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, "");
        const qrCodeBuffer = Buffer.from(base64Data, 'base64');
          bot.sendPhoto(chatId, qrCodeBuffer, {
          caption: `Данные для устройства ${deviceKey}:\n<pre>${deviceUrl}</pre>`,
          parse_mode: 'HTML',
          reply_markup: {
          inline_keyboard: [
          [{ text: 'Назад', callback_data: 'devices' }]
        ]
      }
    });
  });
});

  } else if (action.startsWith('add_')) {
    const deviceKey = action.split('_')[1];

          const options = {
            reply_markup: {
              inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]]
            }
          };
    console.log('кнопка', deviceKey);
    bot.sendMessage(chatId, `Функция добавления устройства ${deviceKey} пока недоступна.`, options);

  }  else if (action.startsWith('delete_')) {
    const deviceKey = action.split('_')[1];

          const options = {
            reply_markup: {
              inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]]
            }
          };
    console.log('кнопка', deviceKey);
    bot.sendMessage(chatId, `Функция удаления устройства ${deviceKey} пока недоступна.`, options);

  } else if (action === 'back_to_profile') {
    profile(chatId);
  }
});





// Обработчик команды /admin с проверкой прав администратора
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const isAdminUser = await isAdmin(chatId);
    if (isAdminUser) {
      admin(chatId); // Запуск административного меню
    } else {
      bot.sendMessage(chatId, 'У вас нет прав для доступа к этой команде.');
    }
  } catch (error) {
    console.error('Ошибка проверки прав администратора:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при проверке ваших прав. Пожалуйста, попробуйте позже.');
  }
});

// Функция проверки, является ли пользователь администратором
function isAdmin(chatId) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT admin FROM users WHERE chatId = ?';
    db.query(query, [chatId], (err, results) => {
      if (err) {
        console.error('Ошибка выполнения запроса к базе данных:', err);
        reject(err);
      } else if (results.length > 0 && results[0].admin === 1) {
        console.log('Пользователь является администратором.');
        resolve(true);
      } else {
        console.log('Пользователь не является администратором.');
        resolve(false);
      }
    });
  });
}

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
async function updateBalance(chatId, paymentAmount) {
  const user = await getUserByChatId(chatId);

  const newBalance = parseFloat(user.balance) + paymentAmount;

  const query = `
    UPDATE users 
    SET balance = ?, lastPaymentDate = NOW(), paymentAmount = ? 
    WHERE chatId = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [newBalance, paymentAmount, chatId], (err) => {
      if (err) {
        console.error('Ошибка обновления баланса:', err);
        reject(err);
      } else {


        const message = `Ваш баланс успешно обновлен! Новая сумма: ${newBalance.toFixed(2)}. Сумма вашего платежа: ${paymentAmount.toFixed(2)}. Спасибо за пополнение!`;
        
        bot.sendMessage(chatId, message)



        resolve(newBalance);
      }
    });
  });
}

// Обработчик функции admin
function admin(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Список пользователей', callback_data: 'user_list_0' }],  // Начнем с 0 страницы
        [{ text: 'Данные пользователя', callback_data: 'user_data' }]
      ]
    }
  };
  bot.sendMessage(chatId, 'Выберите действие:', options);
}

// Функция для получения пользователей
async function getUsers(offset, limit) {
  const query = 'SELECT chatId, balance FROM users LIMIT ? OFFSET ?';
  return new Promise((resolve, reject) => {
    db.query(query, [limit, offset], (err, results) => {
      if (err) {
        console.error('Ошибка выполнения запроса к базе данных:', err);
        reject(err);
      } else {
        console.log('Результат запроса пользователей:', results); // Отладка
        resolve(results);
      }
    });
  });
}

// Обработчик списка пользователей и кнопок
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action.startsWith('user_list_')) {
    const page = parseInt(action.split('_')[2]);
    const usersPerPage = 10;
    const offset = page * usersPerPage;

    try {
      const users = await getUsers(offset, usersPerPage);

      if (!Array.isArray(users) || users.length === 0) {
        bot.sendMessage(chatId, 'Список пользователей пуст или вы на последней странице.');
        return;
      }

      let message = 'Список пользователей:\n';
      users.forEach((user, index) => {
        const balance = parseFloat(user.balance).toFixed(2);
        message += `Id: \`${user.chatId}\`, balance: ${balance}\n`;
      });

      const navigationButtons = [];
      if (page > 0) {
        navigationButtons.push({ text: 'Назад', callback_data: `user_list_${page - 1}` });
      }
      if (users.length === usersPerPage) {
        navigationButtons.push({ text: 'Вперед', callback_data: `user_list_${page + 1}` });
      }

      const options = {
        reply_markup: {
          inline_keyboard: [
            navigationButtons,
            [{ text: 'Вернуться в меню', callback_data: 'back_to_admin' }]
          ]
        },
        parse_mode: 'Markdown'  // Устанавливаем режим Markdown для работы ссылки
      };
      bot.sendMessage(chatId, message, options);

    } catch (err) {
      console.error('Ошибка получения пользователей:', err);
      bot.sendMessage(chatId, 'Произошла ошибка при получении списка пользователей.');
    }
  }

  if (action === 'user_data') {
    bot.sendMessage(chatId, 'Введите chatId пользователя, данные которого нужно изменить:');
    bot.once('message', async (msg) => {
      const userChatId = msg.text;
      try {
        const user = await getUserByChatId(userChatId);
        let message = `Данные пользователя ${user.chatId}:\n`;
        message += `Баланс: ${user.balance}\n`;
        message += `Последний платеж: ${user.lastPaymentDate}\n`;
        message += `Сумма последнего платежа: ${user.paymentAmount}\n`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Изменить баланс', callback_data: 'change_balance_' + user.chatId }],
            [{ text: 'Блокировка', callback_data: 'block_user_' + user.chatId }],
            [{ text: 'Назад', callback_data: 'back_to_admin' }]  // Кнопка назад
          ]
        }
      };

        bot.sendMessage(chatId, message, options);
      } catch (err) {
        bot.sendMessage(chatId, 'Ошибка получения данных пользователя.');
      }
    });
  }

  // Обработчик для кнопки "Вернуться в меню"
  if (action === 'back_to_admin') {
    admin(chatId); // Возвращаем в меню администратора
  }

  if (action.startsWith('change_balance_')) {
    const userChatId = action.split('_')[2];
    bot.sendMessage(chatId, `Введите сумму платежа для пользователя ${userChatId} (может быть отрицательной):`);
    bot.once('message', async (msg) => {
      const paymentAmount = parseFloat(msg.text);
      if (isNaN(paymentAmount)) {
        bot.sendMessage(chatId, 'Некорректная сумма платежа.');
        return;
      }

      try {
        const newBalance = await updateBalance(userChatId, paymentAmount);
        bot.sendMessage(chatId, `Баланс пользователя ${userChatId} успешно обновлен. Новый баланс: ${newBalance}`);
      } catch (err) {
        bot.sendMessage(chatId, 'Ошибка обновления баланса.');
      }
    });
  }
});

// Обработчик callback_query для блокировки
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action.startsWith('block_user_')) {
    const userChatId = action.split('_')[2];
    
    // Получаем текущий статус блокировки пользователя
    try {
      const user = await getUserByChatId(chatId);
      let message = `Статус блокировки пользователя ${user.chatId}:\n`;
      message += `Заблокирован: ${user.locked === 1 ? 'Да' : 'Нет'}\n`;
      message += `Дата блокировки: ${user.lockedDate ? user.lockedDate : 'Не установлена'}\n`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{
              text: user.locked === 0 ? 'Заблокировать' : 'Разблокировать',
              callback_data: 'change_block_status_' + user.chatId
            }],
            [{ text: 'Назад', callback_data: 'back_to_admin' }]
          ]
        }
      };
      bot.sendMessage(chatId, message, options);
    } catch (err) {
      bot.sendMessage(chatId, 'Ошибка получения данных пользователя.');
    }
  }

if (action.startsWith('change_block_status_')) {
  const userChatId = action.split('_')[2];
  
  try {
    const user = await getUserByChatId(chatId);
    
    let updateQuery;
    if (user.locked === 0) {
      // Если заблокировать, меняем на 1 и устанавливаем текущую дату для lockedDate
      updateQuery = 'UPDATE users SET locked = 1, lockedDate = NOW() WHERE chatId = ?';
    } else {
      // Если разблокировать, меняем на 0 и не трогаем lockedDate
      updateQuery = 'UPDATE users SET locked = 0 WHERE chatId = ?';
    }

    console.log('Отправка запроса в базу данных для обновления статуса блокировки:');
    console.log('chatId:', chatId);
    console.log('locked:', user.locked === 0 ? 1 : 0);
    
    db.query(updateQuery, [chatId], (err) => {
      if (err) {
        console.error('Ошибка изменения статуса блокировки:', err);
        bot.sendMessage(chatId, 'Произошла ошибка при изменении статуса блокировки.');
      } else {
        const newStatus = user.locked === 0 ? 'заблокирован' : 'разблокирован';
        bot.sendMessage(chatId, `Пользователь ${chatId} теперь ${newStatus}.`);
        
        // Повторно показываем информацию о пользователе
        bot.sendMessage(chatId, `Статус пользователя ${chatId} обновлен.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Назад', callback_data: 'back_to_admin' }]
            ]
          }
        });
      }
    });
  } catch (err) {
    console.error('Ошибка получения данных пользователя для изменения статуса блокировки:', err);
    bot.sendMessage(chatId, 'Ошибка при изменении статуса блокировки.');
  }
}

// Функция для удаления устройства
function deleteDevice(chatId, deviceKey) {
  db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], (err, results) => {
    if (err || results.length === 0) {
      bot.sendMessage(chatId, 'Произошла ошибка при получении данных устройства.');
      return;
    }

    const deviceUrl = results[0][deviceKey];
    if (!deviceUrl || deviceUrl === '0') {
      bot.sendMessage(chatId, 'Устройство не найдено.');
      return;
    }

    // Извлекаем clientId из URL (UUID в формате xxxx-xxxx-xxxx-xxxx)
    const clientIdMatch = deviceUrl.match(/vless:\/\/([a-f0-9-]+)@/);
    if (!clientIdMatch) {
      bot.sendMessage(chatId, 'Не удалось извлечь clientId.');
      return;
    }
    const clientId = clientIdMatch[1];

    // Запрос на удаление устройства через API 3x-ui
    const apiEndpoint = `http://nl-del.rollyk.ru:2053/login`; // Замените на URL вашего API
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    };

    fetch(apiEndpoint, options)
      .then(response => response.json())
      .then(apiResult => {
        if (apiResult.success) {
          // Успешное удаление, обновляем базу данных
          db.query(`UPDATE users SET \`${deviceKey}\` = '0' WHERE chatId = ?`, [chatId], (err) => {
            if (err) {
              bot.sendMessage(chatId, 'Произошла ошибка при обновлении данных.');
            } else {
              bot.sendMessage(chatId, `Устройство ${deviceKey} успешно удалено.`);
            }
          });
        } else {
          bot.sendMessage(chatId, 'Не удалось удалить устройство через API.');
        }
      })
      .catch(err => {
        console.error('Ошибка при обращении к API:', err);
        bot.sendMessage(chatId, 'Произошла ошибка при обращении к API.');
      });
  });
}

// Обработчик для удаления устройства
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action.startsWith('delete_')) {
    const deviceKey = action.split('_')[1];
    deleteDevice(chatId, deviceKey);
  }
});

});