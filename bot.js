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

  const query = `INSERT INTO users (chatId, phone, lang, name, registrationDate, lastPaymentDate, paymentAmount, balance, lastBillDate, locked, lockedDate, files, plan_id, \`vless-1\`, \`vless-2\`, \`vless-3\`, \`vless-4\`, \`vless-5\`) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [chatId, null, null, null, registrationDate, lastPaymentDate, 0, 0, lastBillDate, 1, registrationDate, null, 2, 0, 0, 0, 0, 0];
  
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
