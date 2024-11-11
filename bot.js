const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/db');
const moment = require('moment');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_API, { polling: true });

// Команда /start для отображения главного меню
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

// Команда /balance для получения баланса пользователя
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  showBalance(chatId);
});

// Обработчик команды /id
bot.onText(/\/id/, (msg) => {
  const chatId = msg.chat.id;
  showId(chatId);
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

      bot.sendMessage(chatId, 'Добро пожаловать!\nПожалуйста, зарегистрируйтесь, чтобы продолжить:', options);

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
      const hourlyRate = planPrice / (30 * 24); // делим на количество часов в месяце (30 дней * 24 часа)

      // Приветственное сообщение
      const welcomeText = `Добро пожаловать, ${user.name || 'пользователь'}!\n` +
        `Ваш ID: ${chatId}\n` +
        `Телефон: ${user.phone || 'не указан'}\n` +
        `Ваш баланс: ${Number(user.balance).toFixed(2)}\n` +
        `Количество устройств: ${devicesCount}\n` +
        `Абонентская плата: ${hourlyRate.toFixed(2)} за час`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Узнать свой ID', callback_data: 'show_id' }],
            [{ text: 'Баланс/Инфо', callback_data: 'show_balance' }],
            [{ text: 'Мои данные', callback_data: 'profile' }],
            [{ text: 'Удалить аккаунт', callback_data: 'delete_account' }]
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
  if (action === 'show_id') {
    showId(chatId);
  } else if (action === 'show_balance') {
    showBalance(chatId);
  } else if (action === 'profile') {
    profile(chatId);
  } else if (action === 'back_to_main') {
    showMainMenu(chatId);
  } else if (action === 'register') {
    register(chatId);
  }
});

// Функция для показа ID
function showId(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Назад', callback_data: 'back_to_main' }]
      ]
    }
  };
  bot.sendMessage(chatId, `Ваш chatId: \`${chatId}\``, { parse_mode: 'MarkdownV2', ...options });
}

// Функция для показа баланса
function showBalance(chatId) {
  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], (err, users) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при получении информации.');
      return;
    }

    if (users.length > 0) {
      const user = users[0];
      const balanceMessage = `Ваш баланс: ${Number(user.balance).toFixed(2)}`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Назад', callback_data: 'back_to_main' }]
          ]
        }
      };
      bot.sendMessage(chatId, balanceMessage, options);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
}

//Меню данных
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
            [{ text: 'Назад', callback_data: 'back_to_main' }]
          ]
        }
      };

      // Формируем сообщение
      const profile = `Имя: ${user.name}\nТелефон: ${user.phone}\n`;
      
      // Отправляем сообщение вместе с кнопкой "Назад"
      bot.sendMessage(chatId, profile, options);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
}

// Функция регистрации
function register(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Назад', callback_data: 'back_to_main' }]
      ]
    }
  };
  bot.sendMessage(chatId, `Text`, options);
}