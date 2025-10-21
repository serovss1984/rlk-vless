const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/db');
const moment = require('moment');
const QRCode = require('qrcode');
const axios = require('axios');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_API, { polling: true });

const YOOMONEY_CLIENT_ID = process.env.YOOMONEY_CLIENT_ID;
const YOOMONEY_REDIRECT_URI = process.env.YOOMONEY_REDIRECT_URI;

// Команда /start для отображения главного меню
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

// Функция для расчета почасовой стоимости
const calculateHourlyRate = (planPrice, user) => {
  // Почасовая стоимость базового тарифа
  const baseHourlyRate = parseFloat(planPrice) / (30 * 24);

  if (!user) {
    console.error("Ошибка: данные пользователя отсутствуют.", err);
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

// Функция для показа главного меню с проверкой регистрации
function showMainMenu(chatId) {
  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], async (err, users) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при проверке регистрации.');
      console.error('Ошибка запроса:', err);
      return;
    }

    // Если пользователя нет в базе, показываем меню с кнопкой "Регистрация"
    if (users.length === 0) {
//      console.log('Пользователь не найден, показываем меню с регистрацией');

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

      // Получаем цену плана из базы данных
      db.query('SELECT * FROM plans WHERE id = ?', [user.plan_id], (err, plans) => {
        if (err || plans.length === 0) {
          bot.sendMessage(chatId, 'Ошибка при получении данных о тарифе.');
          return;
        }

        const plan = plans[0];
        const planPrice = plan ? plan.price : 0;

        // Рассчитываем почасовую стоимость
        const hourlyRate = calculateHourlyRate(planPrice, user);

        // Логика для подсчета количества устройств
        const vlessFields = ['NL', 'GE'];
        let devicesCount = 0;

        vlessFields.forEach(field => {
          if (user[field] && user[field] !== '0') {
            devicesCount++;
          }
        });

        // Логика для вычисления абонентской платы
	       const dailyRate = devicesCount > 0 ? (hourlyRate * 24) : 0; // суточная абонентская плата
	       const daysLeft = dailyRate > 0 ? Math.floor(user.balance / dailyRate) : Infinity; // вычисляем, на сколько дней хватит средств

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
              `Ваш баланс: ${Number(user.balance).toFixed(2)} руб.\n` +
              `Конфигурации: ${devicesCount}\n` +
              `Абонентская плата: ${hourlyRate.toFixed(2)} руб. в час\n` +
              `Средств хватит на ${daysLeftText}\n` +
              `Заблокирован: ${lockedStatus}`;

        // Базовые кнопки
        const keyboard = [
          [{ text: 'Мои данные', callback_data: 'profile' }],
          [{ text: 'Мои конфигурации', callback_data: 'devices' }],
          [{ text: 'Оплата', callback_data: 'payment' }],
          [{ text: 'Помощь', callback_data: 'help' }],
          [{ text: 'Обновить', callback_data: 'back_to_main' }]
        ];

        // Добавляем кнопку "Stuff", если admin === 1
        if (user.admin === 1) {
          keyboard.push([{ text: 'Админка', callback_data: 'admin' }]);
        }

        const options = {
          reply_markup: {
            inline_keyboard: keyboard
          }
        };

        bot.sendMessage(chatId, welcomeText, options);
//	console.log(chatId)
//	console.log(welcomeText,'\n');
      });
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
  } else if (action === 'payment') {
    payment(chatId);
  } else if (action === 'admin') {
    admin(chatId);
  } else if (action === 'help') {
    help(chatId);
  } else if (action === 'payment_ac') {
    payment_ac(chatId);
  } else if (action === 'payment_sbp') {
    payment_sbp(chatId);
  }
});

// Помощь
function help(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: 'Назад', callback_data: 'back_to_main' }]]
    }
  };
  bot.sendMessage(chatId, `Для получения помощи обратитесь в сообщество https://t.me/RLK_ovpn_support`, options);
}

function payment(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
//          { text: 'Карта', callback_data: 'payment_ac' },
          { text: 'СБП', callback_data: 'payment_sbp' }
        ],
        [{ text: 'Назад', callback_data: 'back_to_main' }]
      ]
    }
  };
  bot.sendMessage(chatId, 'Выберите способ оплаты:', options);
};

// Оплата по карте
const userStates = {}; // тут будем хранить состояние

function payment_ac(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: 'Назад', callback_data: 'payment' }]]
    }
  };

  // Запоминаем, что пользователь сейчас вводит сумму для карты
  userStates[chatId] = 'awaiting_card_amount';

  bot.sendMessage(chatId, 'Оплата банковской картой.\nВведите сумму платежа без копеек.', options);
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (state === 'awaiting_card_amount') {
    const amount = msg.text.trim();

    if (!/^\d+$/.test(amount)) {
      return bot.sendMessage(chatId, 'Пожалуйста, введите корректную сумму (только цифры).');
    }

    // Очищаем состояние, чтобы не обрабатывать повторно
    userStates[chatId] = null;

    const yoomoneyUrl = `https://yoomoney.ru/quickpay/confirm?receiver=${process.env.YOOMONEY_CLIENT_ID}&label=${chatId}&quickpay-form=button&sum=${amount}&paymentType=AC&successURL=${process.env.YOOMONEY_REDIRECT_URI}`;

    const payOptions = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Перейти к оплате', url: yoomoneyUrl }],
          [{ text: 'Назад', callback_data: 'payment_ac' }]
        ]
      }
    };

    bot.sendMessage(chatId, `Сумма: ${amount} ₽\nНажмите на кнопку, чтобы перейти к оплате:`, payOptions);
  }
});

// Оплата по СБП
function payment_sbp(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: 'Назад', callback_data: 'payment' }]]
    }
  };
  bot.sendMessage(chatId, `Оплата производится через СБП.\nВведите сумму платежа без копеек:`, options);

  // Ожидание ввода суммы от пользователя
  bot.once('message', async (msg) => {
    const amount = msg.text;

    // Проверка, что введённое значение является числом
    if (!/^\d+$/.test(amount)) {
      return bot.sendMessage(chatId, 'Пожалуйста, введите корректную сумму (только цифры).');
    }

    try {
      // Тело запроса
      const requestData = {
        chatId: String(chatId), // Убедимся, что chatId - строка
        amount: Number(amount) * 100  // Убедимся, что amount - число
      };

      // Логируем тело запроса
//      console.log('Отправляемые данные:', requestData);

      // Отправка данных в ваш API
      const response = await axios.post('http://127.0.0.1:3302/', requestData, {
        headers: {
          'Content-Type': 'application/json' // Явно указываем заголовок
        }
      });

      // Вывод результата в консоль
//      console.log('Ответ от API:', response.data);

      const { payload, qrcId, image } = response.data.bankResponse.Data;

      // Формируем сообщение для пользователя
      const paymentMessage = `Ссылка на оплату: ${payload}`;

      // Отправляем сообщение с ссылкой на оплату и QR-код ID
      bot.sendMessage(chatId, paymentMessage);

      // Добавляем кнопку "Назад"
      const backOptions = {
        reply_markup: {
          inline_keyboard: [[{ text: 'Назад', callback_data: 'payment' }]]
        }
      };
      bot.sendMessage(chatId, 'Для возврата в главное меню нажмите кнопку "Назад".', backOptions);

    } catch (error) {
      console.error('Ошибка при отправке данных в API:', error);

      // Уведомление пользователя об ошибке
      bot.sendMessage(chatId, 'Произошла ошибка при отправке данных. Попробуйте ещё раз.');
    }
  });
};

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

      const profile = `Имя: ${user.name || 'не указано'}\nТелефон: ${user.phone || 'не указан'}\n`;
      bot.sendMessage(chatId, profile, options);
//      console.log(chatId);
//      console.log(profile);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
}

// Обработчик для изменения имени и телефона
bot.on('callback_query', query => {
  const chatId = query.message.chat.id;

  if (query.data === 'edit_name') {
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: 'Назад', callback_data: 'back_to_profile' }]]
    }
  };

    bot.sendMessage(chatId, 'Введите имя:', options);
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
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: 'Назад', callback_data: 'back_to_profile' }]]
    }
  };

    bot.sendMessage(chatId, 'Введите телефон начиная с +7:', options);
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

  const query = `INSERT INTO users (chatId, phone, lang, name, registrationDate, lastPaymentDate, paymentAmount, balance, lastBillDate, locked, lockedDate, files, plan_id, \`NL\`, \`GE\`, admin, adminWhoBill)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [chatId, null, null, null, registrationDate, lastPaymentDate, 10, 10, lastBillDate, 0, lastPaymentDate, null, 2, 0, 0, 0, null];
  
  db.query(query, values, (err) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при регистрации.');
      console.error('Ошибка при записи в базу данных:', err);
      return;
    }

    bot.sendMessage(chatId, 'Вы успешно зарегистрированы!');
    bot.sendMessage(5906119921, `Пользователь ${chatId} зарегистрирован`);

    // После регистрации возвращаем пользователя в главное меню
    showMainMenu(chatId);
  });
}

// Функции просмотра, удаления и добавления конфигураций
function devices(chatId) {
  db.query('SELECT `NL`, `GE` FROM users WHERE chatId = ?', [chatId], (err, results) => {
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
            { text: `${deviceKey}`, callback_data: `view_${deviceKey}` },
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

      bot.sendMessage(chatId, 'Ваши конфигурации:', options);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
}

//Поиск и просмотр конфигураций
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action.startsWith('view_')) {
    const deviceKey = action.split('_')[1];

    // Проверяем поле в БД и получаем email для API
    db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], async (err, results) => {
      if (err || results.length === 0) {
        bot.sendMessage(chatId, 'Произошла ошибка при получении данных конфигурации.');
        return;
      }

      const deviceValue = results[0][deviceKey];
      if (!deviceValue || deviceValue === '0') {
        bot.sendMessage(chatId, 'Данные для конфигурации не найдены.');
        return;
      }

      // Определяем суффикс
      const suffix = deviceKey === 'NL' ? '-1' : deviceKey === 'GE' ? '-5' : '';
      const email = `${chatId}${suffix}`;

      try {
        // Запрашиваем API
        const resp = await axios.get(`http://localhost:3332/uuid/${email}`);
        const urls = resp.data.urls;

        if (!urls || urls.length === 0) {
          bot.sendMessage(chatId, 'Данные для конфигурации не найдены.');
          return;
        }

        const deviceUrl = urls[0]; // берем первую ссылку (фиксированный SID)

        const qrCodeDataUrl = await QRCode.toDataURL(deviceUrl);
        const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, "");
        const qrCodeBuffer = Buffer.from(base64Data, 'base64');

        await bot.sendPhoto(chatId, qrCodeBuffer, {
          caption: `Данные для конфигурации ${deviceKey}:\n<pre>${deviceUrl}</pre>`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Назад', callback_data: 'devices' }]
            ]
          }
        });

      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, 'Ошибка при получении данных конфигурации.');
      }
    });
  }

// Добавление конфигурации
else if (action.startsWith('add_')) {
  const deviceKey = action.split('_')[1];

  // Проверяем, есть ли уже конфигурация у пользователя
  db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], async (err, results) => {
    if (err || results.length === 0) {
      bot.sendMessage(chatId, 'Произошла ошибка при проверке конфигурации.', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
      });
      return;
    }

    const deviceValue = results[0][deviceKey];
    if (deviceValue && deviceValue !== '0') {
      bot.sendMessage(chatId, `Конфигурация ${deviceKey} уже существует.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Просмотреть', callback_data: `view_${deviceKey}` }],
            [{ text: 'Удалить', callback_data: `delete_${deviceKey}` }],
            [{ text: 'Назад', callback_data: 'devices' }]
          ]
        }
      });
      return;
    }

    try {
      // Определяем суффикс для email
      const suffix = deviceKey === 'NL' ? '-1' : deviceKey === 'GE' ? '-5' : '';
      const email = `${chatId}${suffix}`;

      // Отправляем запрос к API
      const resp = await axios.post(`http://localhost:3332/add/${email}`);

      if (resp.data.success) {
        // Просто записываем префикс (например, "1" для NL) в базу данных
        db.query(`UPDATE users SET \`${deviceKey}\` = ? WHERE chatId = ?`, [suffix, chatId], (updateErr) => {
          if (updateErr) {
            console.error('Database update error:', updateErr);
            bot.sendMessage(chatId, 'Произошла ошибка при сохранении в базу данных.', {
              reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
            });
            return;
          }

          // Успешное создание
          bot.sendMessage(chatId, `✅ Конфигурация ${deviceKey} успешно создана!`, {
            reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
          });
        });
      } else {
        bot.sendMessage(chatId, `❌ Ошибка при создании конфигурации: ${resp.data.error || 'Неизвестная ошибка'}`, {
          reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
        });
      }

    } catch (err) {
      console.error('API Error:', err.response?.data || err.message);
      bot.sendMessage(chatId, '❌ Не удалось создать конфигурацию. Попробуйте позже.', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
      });
    }
  });

// Удаление конфигурации
} else if (action.startsWith('delete_')) {
  const deviceKey = action.split('_')[1];

  // Проверяем поле в БД и получаем email для API
  db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], async (err, results) => {
    if (err || results.length === 0) {
      bot.sendMessage(chatId, 'Произошла ошибка при получении данных конфигурации.');
      return;
    }

    const deviceValue = results[0][deviceKey];
    if (!deviceValue || deviceValue === '0') {
      bot.sendMessage(chatId, 'Для удаления конфигурации данных не найдено.');
      return;
    }

    // Определяем суффикс
    const suffix = deviceKey === 'NL' ? '-1' : deviceKey === 'GE' ? '-5' : '';
    const email = `${chatId}${suffix}`;

    try {
      // Удаляем через API
      const resp = await axios.delete(`http://localhost:3332/delete/${email}`);

      if (resp.data.success) {
        // Обновляем БД — сбрасываем значение
        db.query(`UPDATE users SET \`${deviceKey}\` = '0' WHERE chatId = ?`, [chatId]);

        bot.sendMessage(chatId, `✅ Конфигурация ${deviceKey} успешно удалена.`, {
          reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
        });
      } else {
        bot.sendMessage(chatId, `❌ Ошибка при удалении конфигурации: ${resp.data.error || 'Неизвестная ошибка'}`, {
          reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
        });
      }
    } catch (err) {
      console.error(err.response?.data || err.message);
      bot.sendMessage(chatId, '❌ Не удалось удалить конфигурацию. Попробуйте позже.', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'devices' }]] }
      });
    }
  });

// Возврат в профиль
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
//        console.log('Пользователь является администратором.');
        resolve(true);
      } else {
        console.error('Пользователь не является администратором.');
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
async function updateBalance(chatId, paymentAmount, adminId) {
  const user = await getUserByChatId(chatId);

  const newBalance = parseFloat(user.balance) + paymentAmount;

  const query = `
    UPDATE users 
    SET balance = ?, lastPaymentDate = NOW(), paymentAmount = ?, adminWhoBill = ?
    WHERE chatId = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [newBalance, paymentAmount, adminId, chatId], (err) => {
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
        [{ text: 'Данные пользователя', callback_data: 'user_data' }],
        [{ text: 'Меню пользователя', callback_data: 'back_to_main' }]
      ]
    }
  };
  bot.sendMessage(chatId, 'Выберите действие:', options);
}

// Функция для получения пользователей
async function getUsers(offset, limit) {
  const query = 'SELECT chatId, name, balance, `NL`, `GE`, adminWhoBill FROM users LIMIT ? OFFSET ?';
  return new Promise((resolve, reject) => {
    db.query(query, [limit, offset], (err, results) => {
      if (err) {
        console.error('Ошибка выполнения запроса к базе данных:', err);
        reject(err);
      } else {
//        console.log('Результат запроса пользователей:', results); // Отладка
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
        message += `Name: ${user.name}\n Id: \`${user.chatId}\`, balance: ${balance}\n`;
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
	    [{ text: 'Данные пользователя', callback_data: 'user_data' }],
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
    bot.sendMessage(chatId, 'Введите Id пользователя:');
    bot.once('message', async (msg) => {
      const userChatId = msg.text;
      try {
        const user = await getUserByChatId(userChatId);
	const lastPaymentDate = new Date(user.lastPaymentDate);

        // Логика для подсчета количества устройств
        const vlessFields = ['NL', 'GE'];
        let devicesCount = 0;

        vlessFields.forEach(field => {
          if (user[field] && user[field] !== '0') {
            devicesCount++;
          }
        });

	const formattedDate = new Intl.DateTimeFormat('ru-RU', {
	  year: 'numeric',
	  month: 'long',
	  day: 'numeric',
	  hour: '2-digit',
	  minute: '2-digit'
	}).format(lastPaymentDate);
        let message = `Данные пользователя ${user.chatId}:\n`;
        message += `Имя: ${user.name}\n`;
        message += `Телефон: ${user.phone}\n`;
        message += `Баланс: ${user.balance}\n`;
        message += `Тариф: ${user.plan_id}\n`;
        message += `Блокировка: ${user.locked}\n`;
        message += `Конфигурации: ${devicesCount}\n`;
        message += `Последний платеж: ${formattedDate}\n`;
        message += `Кто изменил: ${user.adminWhoBill}\n`;
        message += `Сумма последнего платежа: ${user.paymentAmount}\n`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Изменить баланс', callback_data: 'change_balance_' + user.chatId }],
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
    const adminId = query.from.id;  // ID администратора, который выполняет запрос

    bot.sendMessage(chatId, `Введите сумму платежа для пользователя ${userChatId} (может быть отрицательной):`);
    bot.once('message', async (msg) => {
      const paymentAmount = parseFloat(msg.text);
      if (isNaN(paymentAmount)) {
        bot.sendMessage(chatId, 'Некорректная сумма платежа.');
        return;
      }

      try {
        const newBalance = await updateBalance(userChatId, paymentAmount, adminId);
        bot.sendMessage(chatId, `Баланс пользователя ${userChatId} успешно обновлен. Новый баланс: ${newBalance}`);
      } catch (err) {
        bot.sendMessage(chatId, 'Ошибка обновления баланса.');
      }
    });
  }
});
