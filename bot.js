const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/db');
const moment = require('moment');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Обработчик команды /id
bot.onText(/\/id/, (msg) => {
  const Id = msg.chat.id;
  
  // Отправляем chatId в формате монопространственного текста
  bot.sendMessage(chatId, `Ваш chatId: \`${chatId}\``, { parse_mode: 'MarkdownV2' });
});

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  // Проверяем, есть ли пользователь в базе
  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], (err, results) => {
    if (err) {
      console.error('Ошибка запроса к базе данных:', err);
      return bot.sendMessage(chatId, 'Произошла ошибка, попробуйте позже.');
    }

    if (results.length === 0) {
      // Если пользователя нет в базе, предлагаем выбрать язык
      const languageOptions = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Русский', callback_data: 'set_lang_ru' },
              { text: 'English', callback_data: 'set_lang_en', callback_data: 'disabled' },
              { text: '한국인', callback_data: 'set_lang_ko', callback_data: 'disabled' },
            ]
          ]
        }
      };
      
      bot.sendMessage(chatId, 'Выберете язык / Select language / 언어 선택', languageOptions);
    } else {
      // Если пользователь уже зарегистрирован, можно отправить другое приветственное сообщение или оповестить, что он уже в системе
      bot.sendMessage(chatId, 'Вы уже зарегистрированы в сервисе.');
    }
  });
});

// Обработчик выбора языка
bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  if (data === 'set_lang_ru') {
    // Получаем цену для плана с id 2
    db.query('SELECT price FROM plans WHERE id = ?', [2], (err, results) => {
      if (err) {
        console.error('Ошибка получения цены из базы данных:', err);
        return bot.sendMessage(chatId, 'Произошла ошибка, попробуйте позже.');
      }

      if (results.length > 0) {
        const price = results[0].price;

        // Отправляем приветственное сообщение с указанием стоимости
        const welcomeMessage = `Добро пожаловать в сервис Vless от RLK Media, стоимость ${price} в месяц, за одно устройство.`;
        const registrationOptions = {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Зарегистрироваться', callback_data: 'register_user' }]
            ]
          }
        };

        bot.editMessageText(welcomeMessage, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: registrationOptions.reply_markup
        });
      } else {
        bot.sendMessage(chatId, 'Не удалось получить информацию о тарифе.');
      }
    });
  }
});

// Обработчик регистрации пользователя
bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  if (data === 'register_user') {
    // Записываем пользователя в базу данных
    db.query(
      `INSERT INTO users (chatId, lang, registrationDate, lastPaymentDate, paymentAmount, balance, locked, plan_id)
       VALUES (?, 'ru', NOW(), NOW(), 0, 0, 0, 2)`,
      [chatId],
      (err, result) => {
        if (err) {
          console.error('Ошибка регистрации пользователя:', err);
          return bot.sendMessage(chatId, 'Произошла ошибка при регистрации, попробуйте позже.');
        }

        bot.editMessageText('Вы успешно зарегистрированы!', { chat_id: chatId, message_id: messageId });
      }
    );
  }
});

// Команда /balance для получения баланса пользователя
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;

  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], (err, users) => {
    if (err) {
      bot.sendMessage(chatId, 'Произошла ошибка при получении информации.');
      return;
    }

    if (users.length > 0) {
      const user = users[0];
      bot.sendMessage(chatId, `Ваш баланс: ${Number(user.balance).toFixed(2)}`);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
  });
});

// Другие команды и функционал можно добавить по мере необходимости
