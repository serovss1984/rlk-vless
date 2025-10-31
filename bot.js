const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/db');
const moment = require('moment');
const QRCode = require('qrcode');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_API, { polling: true });
const TELEGRAM_BOT_API = process.env.TELEGRAM_BOT_API

const YOOMONEY_CLIENT_ID = process.env.YOOMONEY_CLIENT_ID;
const YOOMONEY_REDIRECT_URI = process.env.YOOMONEY_REDIRECT_URI;

let adminChatIds = [];

// Загрузка Telegram ID администраторов
const loadAdminChatIds = () => {
  db.query('SELECT chatId FROM users WHERE admin = 1', (err, results) => {
    if (err) {
      console.error('Ошибка загрузки администраторов:', err);
      return;
    }

    adminChatIds = results.map(row => row.chatId);
    console.log(`Администраторы загружены: ${adminChatIds.join(', ')}`);
  });
};

// Загружаем админов при старте
loadAdminChatIds();

// Функция отправки уведомлений в Telegram
const sendTelegramNotification = (chatId, message) => {
  console.log(`📤 Отправка уведомления для ${chatId}`);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_API}/sendMessage`;

  return axios.post(url, {  // ДОБАВЛЯЕМ return здесь
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  })
  .then(response => {
    console.log(`✅ Уведомление отправлено успешно для ${chatId}`);
    return response;
  })
  .catch(error => {
    console.error(`❌ Ошибка отправки уведомления для ${chatId}:`, error.response?.data || error.message);
    throw error;
  });
};

// Обработчики команд /start
// Обычный старт без рефералки
bot.onText(/\/start$/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

// Старт с реферальной ссылкой
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const referrerRefCode = match[1]; // Это ref_url приглашающего

  // Ищем chatId приглашающего по его ref_url
  db.query('SELECT chatId, name FROM users WHERE ref_url = ?', [referrerRefCode], (err, results) => {
    if (err) {
      console.error('Ошибка поиска реферера:', err);
      showMainMenu(chatId);
      return;
    }

    if (results.length > 0) {
      const referrerChatId = results[0].chatId;
      const referrerName = results[0].name || `пользователь ${referrerChatId}`;
      
      // Проверяем, не пытается ли пользователь зарегистрироваться сам по себе
      if (referrerChatId !== chatId.toString()) {
        // Показываем сообщение о приглашении и начинаем регистрацию
        const options = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Зарегистрироваться', callback_data: `register_with_ref_${referrerChatId}` }],
              [{ text: '❌ Отмена', callback_data: 'cancel_registration' }]
            ]
          }
        };
        
        bot.sendMessage(chatId, `👋 Вас пригласил: ${referrerName}\n\nДля продолжения необходимо зарегистрироваться в системе.`, options);
      } else {
        // Пользователь перешел по своей же ссылке
        showMainMenu(chatId);
      }
    } else {
      // Реферер не найден
      showMainMenu(chatId);
    }
  });
});

// Функция для расчета почасовой стоимости
const calculateHourlyRate = (planPrice, user) => {
  // Почасовая стоимость базового тарифа
  const baseHourlyRate = parseFloat(planPrice) / (30 * 24);

  if (!user) {
    console.error("Ошибка: данные пользователя отсутствуют.");
    return 0;
  }

  // Массив полей vless - ТОЛЬКО NL и DE
  const vlessFields = ['NL', 'DE'];
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

        // Логика для подсчета количества устройств - ТОЛЬКО NL и DE
        const vlessFields = ['NL', 'DE'];
        let devicesCount = 0;

        vlessFields.forEach(field => {
          if (user[field] && user[field] !== '0') {
            devicesCount++;
          }
        });

        // Логика для вычисления абонентской платы
        const dailyRate = devicesCount > 0 ? (hourlyRate * 24) : 0;
        const daysLeft = dailyRate > 0 ? Math.floor(user.balance / dailyRate) : Infinity;

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

        const refLink = `https://t.me/RLK_ovpn_bot?start=${user.ref_url}`;

        const welcomeText = `👋 Добро пожаловать, ${user.name || 'пользователь'}!

🆔 Ваш ID: ${chatId}
💰 Баланс: ${Number(user.balance).toFixed(2)} руб.
🤝 Реферальный баланс: ${Number(user.ref_balance).toFixed(2)} руб.
🔗 Ваша реферальная ссылка:
${refLink}

📱 Активных подписок: ${devicesCount}
⏰ Абонентская плата: ${hourlyRate.toFixed(2)} руб./час
📅 Средств хватит на: ${daysLeftText}
🔒 Статус: ${lockedStatus === 'Да' ? '❌ Заблокирован' : '✅ Активен'}`;

        // Базовые кнопки
        const keyboard = [
          [{ text: '👤 Мои данные', callback_data: 'profile' }],
          [{ text: '📱 Мои подписки', callback_data: 'devices' }],
          [{ text: '💳 Оплата', callback_data: 'payment' }],
          [{ text: '🤝 Рефералка', callback_data: 'referral' }],
          [{ text: '❓ Помощь', callback_data: 'help' }],
          [{ text: '🔄 Обновить', callback_data: 'back_to_main' }]
        ];

        // Добавляем кнопку "Админка", если admin === 1
        if (user.admin === 1) {
          keyboard.push([{ text: '⚙️ Админка', callback_data: 'admin' }]);
        }

        const options = {
          reply_markup: {
            inline_keyboard: keyboard
          }
        };

        bot.sendMessage(chatId, welcomeText, options);
      });
    }
  });
}

// Функция для отображения реферального меню
function referral(chatId) {
  db.query('SELECT ref_url, ref_balance FROM users WHERE chatId = ?', [chatId], (err, userResults) => {
    if (err) {
      bot.sendMessage(chatId, '❌ Произошла ошибка при получении реферальных данных.');
      return;
    }

    if (userResults.length > 0) {
      const user = userResults[0];
      
      // Получаем количество рефералов
      db.query('SELECT COUNT(*) as refCount FROM users WHERE invited_by = ?', [chatId], (err, countResults) => {
        const refCount = countResults[0].refCount;
        const refLink = `https://t.me/RLK_ovpn_bot?start=${user.ref_url}`;
        const refBalance = Number(user.ref_balance).toFixed(2);

        // Получаем контакты поддержки из БД
        db.query('SELECT `data` FROM `settings` WHERE `name` = "helnames"', (err, helpResults) => {
          let supportContacts = '👨‍💻 Поддержка: @admin';
          
          if (!err && helpResults.length > 0) {
            const helpData = helpResults[0].data;
            if (helpData && helpData.trim() !== '') {
              // Разделяем контакты по запятой и форматируем
              const contacts = helpData.split(',').map(contact => contact.trim()).filter(contact => contact !== '');
              if (contacts.length > 0) {
                supportContacts = `👨‍💻 Поддержка: ${contacts.map(contact => {
                  // Если контакт начинается с @, делаем его кликабельным
                  if (contact.startsWith('@')) {
                    return contact;
                  } else if (contact.startsWith('https://t.me/')) {
                    const username = contact.replace('https://t.me/', '@');
                    return username;
                  } else {
                    return contact;
                  }
                }).join(' или ')}`;
              }
            }
          }

          // Получаем размер реферального бонуса из плана пользователя
          db.query('SELECT p.ref_start FROM users u JOIN plans p ON u.plan_id = p.id WHERE u.chatId = ?', [chatId], (err, bonusResults) => {
            const refBonus = bonusResults.length > 0 ? bonusResults[0].ref_start : 50;
            
            const message = `🤝 *Реферальная программа*

🔗 Ваша реферальная ссылка:
\`${refLink}\`

💰 Реферальный баланс: *${refBalance} руб.*

💡 *Как это работает:*
• Приглашайте друзей по вашей ссылке
• Каждый приглашенный друг приносит вам *${refBonus}₽*
• Реферальные средства можно использовать для оплаты подписок

📊 *Ваша статистика:*
• Приглашено: *${refCount} человек*
• Доступно к выводу: *${refBalance} руб.*

${supportContacts}`;

            const options = {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📤 Поделиться ссылкой', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=Присоединяйся%20к%20Azernet!` }],
                  [{ text: '💳 Вывести средства', callback_data: 'withdraw_ref' }],
                  [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                ]
              },
              parse_mode: 'Markdown'
            };

            bot.sendMessage(chatId, message, options);
          });
        });
      });
    } else {
      bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }
  });
}

// Функция для вывода реферальных средств
function withdrawReferral(chatId) {
  // Получаем данные пользователя
  db.query('SELECT ref_balance FROM users WHERE chatId = ?', [chatId], (err, userResults) => {
    if (err || userResults.length === 0) {
      bot.sendMessage(chatId, '❌ Ошибка получения данных.');
      return;
    }

    const refBalance = Number(userResults[0].ref_balance);
    
    if (refBalance <= 0) {
      bot.sendMessage(chatId, 
        '❌ На вашем реферальном балансе недостаточно средств для вывода.\n\n' +
        'Приглашайте друзей по реферальной ссылке, чтобы пополнить баланс.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад к рефералке', callback_data: 'referral' }]
            ]
          }
        }
      );
      return;
    }

    // Получаем контакты поддержки из БД
    db.query('SELECT `data` FROM `settings` WHERE `name` = "helnames"', (err, helpResults) => {
      let supportContacts = ['@admin']; // значение по умолчанию
      
      if (!err && helpResults.length > 0) {
        const helpData = helpResults[0].data;
        if (helpData && helpData.trim() !== '') {
          supportContacts = helpData.split(',').map(contact => contact.trim()).filter(contact => contact !== '');
        }
      }

      const contactsText = supportContacts.map(contact => {
        if (contact.startsWith('@')) {
          return contact;
        } else if (contact.startsWith('https://t.me/')) {
          return contact.replace('https://t.me/', '@');
        } else {
          return contact;
        }
      }).join(' или ');

      const message = `💳 *Вывод реферальных средств*

💰 Доступно для вывода: *${refBalance.toFixed(2)} руб.*

📋 *Условия вывода:*
• Минимальная сумма вывода: *50 руб.*
• Вывод доступен на банковскую карту или телефон
• Обработка заявки: *1-3 рабочих дня*

👨‍💻 *Для вывода средств:*
1. Напишите ${contactsText}
2. Укажите сумму вывода
3. Предоставьте реквизиты для перевода

💡 *Также вы можете использовать реферальные средства для оплаты подписок в разделе "💳 Оплата"*`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✍️ Написать в поддержку', url: `https://t.me/${supportContacts[0].replace('@', '')}` }],
            [{ text: '💳 Оплатить подписку', callback_data: 'payment' }],
            [{ text: '🔙 Назад к рефералке', callback_data: 'referral' }]
          ]
        },
        parse_mode: 'Markdown'
      };

      bot.sendMessage(chatId, message, options);
    });
  });
}

// ЕДИНЫЙ обработчик всех callback_query
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  console.log(`🔄 Callback: ${action} от пользователя ${chatId}`);

  // 1. ОСНОВНЫЕ КНОПКИ ГЛАВНОГО МЕНЮ
  if (action === 'profile') {
    profile(chatId);
  } else if (action === 'back_to_main') {
    showMainMenu(chatId);
  } else if (action === 'register') {
    register(chatId, null, query.message);
  } else if (action === 'devices') {
    devices(chatId);
  } else if (action === 'payment') {
    payment(chatId);
  } else if (action === 'admin') {
    admin(chatId);
  } else if (action === 'referral') {
    referral(chatId);
  } else if (action === 'help') {
    help(chatId);
  } else if (action === 'payment_ac') {
    payment_ac(chatId);
  } else if (action === 'payment_sbp') {
    payment_sbp(chatId);
  } else if (action === 'withdraw_ref') {
  withdrawReferral(chatId);
  } else if (action === 'payment_ref') {
  payment_ref(chatId);
  }

  else if (action.startsWith('register_with_ref_')) {
    const referrerChatId = action.split('_')[3];
    console.log(`🔗 Реферальная регистрация: ${chatId} приглашен ${referrerChatId}`);
    register(chatId, referrerChatId, query.message);
  }

  else if (action === 'cancel_registration') {
    bot.sendMessage(chatId, '❌ Регистрация отменена.');
    showMainMenu(chatId);
  }

  // 4. РЕДАКТИРОВАНИЕ ПРОФИЛЯ
  else if (action === 'edit_name') {
    const options = {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'back_to_profile' }]]
      }
    };
    bot.sendMessage(chatId, '✏️ Введите ваше имя и фамилию:', options);
    bot.once('message', msg => {
      const newName = msg.text;
      db.query('UPDATE users SET name = ? WHERE chatId = ?', [newName, chatId], (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении имени.');
        } else {
          const options = {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'back_to_profile' }]]
            }
          };
          bot.sendMessage(chatId, '✅ Имя успешно обновлено.', options);
        }
      });
    });
  } else if (action === 'edit_phone') {
    const options = {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'back_to_profile' }]]
      }
    };
    bot.sendMessage(chatId, '📞 Введите телефон начиная с +7:', options);
    bot.once('message', msg => {
      const newPhone = msg.text;
      db.query('UPDATE users SET phone = ? WHERE chatId = ?', [newPhone, chatId], (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении телефона.');
        } else {
          const options = {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'back_to_profile' }]]
            }
          };
          bot.sendMessage(chatId, '✅ Телефон успешно обновлен.', options);
        }
      });
    });
  } else if (action === 'back_to_profile') {
    profile(chatId);
  }

  // 5. УСТРОЙСТВА (ПОДПИСКИ)
  else if (action.startsWith('view_')) {
    const deviceKey = action.split('_')[1];
    db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], (err, results) => {
      if (err || results.length === 0) {
        bot.sendMessage(chatId, '❌ Произошла ошибка при получении данных подписок.');
        return;
      }
      const deviceValue = results[0][deviceKey];
      if (!deviceValue || deviceValue === '0') {
        bot.sendMessage(chatId, '❌ Данные для подписок не найдены.');
        return;
      }
      const suffix = deviceKey === 'NL' ? '-1' : deviceKey === 'DE' ? '-5' : '';
      const email = `${chatId}${suffix}`;
      
      // Используем then/catch вместо async/await
      axios.get(`http://localhost:3332/uuid/${email}`)
        .then(resp => {
          const urls = resp.data.urls;
          if (!urls || urls.length === 0) {
            bot.sendMessage(chatId, '❌ Данные для подписки не найдены.');
            return;
          }
          const deviceUrl = urls[0];
          QRCode.toDataURL(deviceUrl)
            .then(qrCodeDataUrl => {
              const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, "");
              const qrCodeBuffer = Buffer.from(base64Data, 'base64');
              const deviceName = deviceKey === 'NL' ? '🇳🇱 Нидерланды' : '🇩🇪 Германия';
              bot.sendPhoto(chatId, qrCodeBuffer, {
                caption: `✅ ${deviceName} подписка\n\n📱 Используйте QR-код или ссылку ниже:\n\n<pre>${deviceUrl}</pre>`,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'devices' }]
                  ]
                }
              });
            })
            .catch(err => {
              console.error(err);
              bot.sendMessage(chatId, '❌ Ошибка при генерации QR-кода.');
            });
        })
        .catch(err => {
          console.error(err);
          bot.sendMessage(chatId, '❌ Ошибка при получении данных подписки.');
        });
    });
  } else if (action.startsWith('add_')) {
    const deviceKey = action.split('_')[1];
    db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], (err, results) => {
      if (err || results.length === 0) {
        bot.sendMessage(chatId, '❌ Произошла ошибка при проверке подписки.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
        });
        return;
      }
      const deviceValue = results[0][deviceKey];
      if (deviceValue && deviceValue !== '0') {
        const deviceName = deviceKey === 'NL' ? '🇳🇱 Нидерланды' : '🇩🇪 Германия';
        bot.sendMessage(chatId, `❌ Подписка ${deviceName} уже активирована.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👀 Просмотреть', callback_data: `view_${deviceKey}` }],
              [{ text: '🗑️ Удалить', callback_data: `delete_${deviceKey}` }],
              [{ text: '🔙 Назад', callback_data: 'devices' }]
            ]
          }
        });
        return;
      }
      
      const suffix = deviceKey === 'NL' ? '-1' : deviceKey === 'DE' ? '-5' : '';
      const email = `${chatId}${suffix}`;
      console.log(`🔄 Попытка создания подписки ${deviceKey} для ${email}`);
      
      axios.post(`http://localhost:3332/add/${email}`)
        .then(resp => {
          if (resp.data.success) {
            db.query(`UPDATE users SET \`${deviceKey}\` = ? WHERE chatId = ?`, ['active', chatId], (updateErr) => {
              if (updateErr) {
                console.error('❌ Database update error:', updateErr);
                bot.sendMessage(chatId, '❌ Ошибка сохранения в базу данных.', {
                  reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
                });
                return;
              }
              
              axios.get(`http://localhost:3332/uuid/${email}`)
                .then(confResp => {
                  const urls = confResp.data.urls;
                  if (!urls || urls.length === 0) {
                    bot.sendMessage(chatId, '✅ Подписка создана, но данные пока недоступны.', {
                      reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
                    });
                    return;
                  }
                  const deviceUrl = urls[0];
                  QRCode.toDataURL(deviceUrl)
                    .then(qrCodeDataUrl => {
                      const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, "");
                      const qrCodeBuffer = Buffer.from(base64Data, 'base64');
                      const deviceName = deviceKey === 'NL' ? '🇳🇱 Нидерланды' : '🇩🇪 Германия';
                      bot.sendPhoto(chatId, qrCodeBuffer, {
                        caption: `✅ ${deviceName} подписка активирована!\n\n📱 Используйте QR-код или ссылку ниже:\n\n<pre>${deviceUrl}</pre>`,
                        parse_mode: 'HTML',
                        reply_markup: {
                          inline_keyboard: [
                            [{ text: '🔙 Назад к подпискам', callback_data: 'devices' }]
                          ]
                        }
                      });
                    })
                    .catch(err => {
                      console.error('❌ Error generating QR code:', err);
                      bot.sendMessage(chatId, '✅ Подписка создана, но не удалось получить конфигурацию.', {
                        reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
                      });
                    });
                })
                .catch(err => {
                  console.error('❌ Error fetching config after add:', err);
                  bot.sendMessage(chatId, '✅ Подписка создана, но не удалось получить конфигурацию.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
                  });
                });
            });
          } else {
            bot.sendMessage(chatId, `❌ Ошибка при создании подписки: ${resp.data.error || 'Неизвестная ошибка'}`, {
              reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
            });
          }
        })
        .catch(err => {
          console.error('❌ API Error:', err.response?.data || err.message);
          let errorMessage = '❌ Не удалось создать подписку. Попробуйте позже.';
          if (err.response?.data?.error?.includes('Duplicate email')) {
            errorMessage = '❌ Эта подписка уже существует в системе. Попробуйте удалить и создать заново.';
          }
          bot.sendMessage(chatId, errorMessage, {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
          });
        });
    });
  } else if (action.startsWith('delete_')) {
    const deviceKey = action.split('_')[1];
    db.query(`SELECT \`${deviceKey}\` FROM users WHERE chatId = ?`, [chatId], (err, results) => {
      if (err || results.length === 0) {
        bot.sendMessage(chatId, '❌ Произошла ошибка при получении данных подписки.');
        return;
      }
      const deviceValue = results[0][deviceKey];
      if (!deviceValue || deviceValue === '0') {
        bot.sendMessage(chatId, '❌ Для удаления подписки данных не найдено.');
        return;
      }
      const suffix = deviceKey === 'NL' ? '-1' : deviceKey === 'DE' ? '-5' : '';
      const email = `${chatId}${suffix}`;
      
      axios.delete(`http://localhost:3332/delete/${email}`)
        .then(resp => {
          if (resp.data.success) {
            db.query(`UPDATE users SET \`${deviceKey}\` = '0' WHERE chatId = ?`, [chatId]);
            const deviceName = deviceKey === 'NL' ? '🇳🇱 Нидерланды' : '🇩🇪 Германия';
            bot.sendMessage(chatId, `✅ Подписка ${deviceName} успешно удалена.`, {
              reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
            });
          } else {
            bot.sendMessage(chatId, `❌ Ошибка при удалении подписки: ${resp.data.error || 'Неизвестная ошибка'}`, {
              reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
            });
          }
        })
        .catch(err => {
          console.error(err.response?.data || err.message);
          bot.sendMessage(chatId, '❌ Не удалось удалить подписку. Попробуйте позже.', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'devices' }]] }
          });
        });
    });
  }

  // 6. АДМИН-ПАНЕЛЬ
  else if (action.startsWith('user_list_')) {
    const page = parseInt(action.split('_')[2]);
    const usersPerPage = 10;
    const offset = page * usersPerPage;
    
    getUsers(offset, usersPerPage)
      .then(users => {
        if (!Array.isArray(users) || users.length === 0) {
          bot.sendMessage(chatId, '📭 Список пользователей пуст или вы на последней странице.');
          return;
        }
        let message = '📋 Список пользователей:\n\n';
        users.forEach((user, index) => {
          const balance = parseFloat(user.balance).toFixed(2);
          const isLocked = Number(user.locked) === 1;
          const subscriptionCount = [user.NL, user.DE].filter(val => val && val !== '0').length;
          message += `👤 ${user.name || 'Без имени'}\n🆔 ${user.chatId}\n💰 ${balance} руб.\n📱 Подписок: ${subscriptionCount}\n🔒 Блокировка: ${isLocked ? 'Да' : 'Нет'}\n\n`;
        });
        const navigationButtons = [];
        if (page > 0) {
          navigationButtons.push({ text: '◀️ Назад', callback_data: `user_list_${page - 1}` });
        }
        if (users.length === usersPerPage) {
          navigationButtons.push({ text: 'Вперед ▶️', callback_data: `user_list_${page + 1}` });
        }
        const options = {
          reply_markup: {
            inline_keyboard: [
              navigationButtons,
              [{ text: '👤 Данные пользователя', callback_data: 'user_data' }],
              [{ text: '🔙 В админку', callback_data: 'back_to_admin' }]
            ]
          }
        };
        bot.sendMessage(chatId, message, options);
      })
      .catch(err => {
        console.error('Ошибка получения пользователей:', err);
        bot.sendMessage(chatId, '❌ Произошла ошибка при получении списка пользователей.');
      });
  } else if (action === 'user_data') {
    bot.sendMessage(chatId, '👤 Введите ID пользователя:');
    bot.once('message', (msg) => {
      const userChatId = msg.text;
      getUserByChatId(userChatId)
        .then(user => {
          const lastPaymentDate = new Date(user.lastPaymentDate);
          const vlessFields = ['NL', 'DE'];
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
          let message = `👤 Данные пользователя ${user.chatId}:\n\n`;
          message += `📛 Имя: ${user.name || 'Не указано'}\n`;
          message += `📞 Телефон: ${user.phone || 'Не указан'}\n`;
          message += `💰 Баланс: ${user.balance} руб.\n`;
          message += `🤝 Реферальный: ${user.ref_balance} руб.\n`;        
          message += `📊 Тариф: ${user.plan_id}\n`;
          message += `${user.locked ? '🔒' : '🔓'} Блокировка: ${user.locked ? 'Да' : 'Нет'}\n`;
          message += `📱 Подписок: ${devicesCount}\n`;
          message += `🕒 Последний платеж: ${formattedDate}\n`;
          message += `👮 Кто изменил: ${user.adminWhoBill || 'Не указан'}\n`;
          message += `💳 Сумма последнего платежа: ${user.paymentAmount || '0'} руб.`;
          const options = {
            reply_markup: {
              inline_keyboard: [
                [{ text: '💰 Изменить баланс', callback_data: 'change_balance_' + user.chatId }],
                [{ text: '🔙 В админку', callback_data: 'back_to_admin' }]
              ]
            }
          };
          bot.sendMessage(chatId, message, options);
        })
        .catch(err => {
          bot.sendMessage(chatId, '❌ Ошибка получения данных пользователя.');
        });
    });
  } else if (action === 'back_to_admin') {
    admin(chatId);
  } else if (action.startsWith('change_balance_')) {
    const userChatId = action.split('_')[2];
    const adminId = query.from.id;
    bot.sendMessage(chatId, `💰 Введите сумму платежа для пользователя ${userChatId} (может быть отрицательной):`);
    bot.once('message', (msg) => {
      const paymentAmount = parseFloat(msg.text);
      if (isNaN(paymentAmount)) {
        bot.sendMessage(chatId, '❌ Некорректная сумма платежа.');
        return;
      }
      updateBalance(userChatId, paymentAmount, adminId)
        .then(newBalance => {
          const adminMessage = `💰 Обновление баланса\n👮 Администратор: ${adminId}\n👤 Пользователь: ${userChatId}\n💳 Сумма: ${paymentAmount} руб.\n💎 Новый баланс: ${newBalance} руб.`;
          const adminPromises = adminChatIds.map(adminId => 
              sendTelegramNotification(adminId, adminMessage)
          );
          return Promise.all(adminPromises);
        })
        .then(() => {
          console.log(`✅ Все администраторы уведомлены об изменении баланса пользователя ${userChatId}`);
        })
        .catch(err => {
          bot.sendMessage(chatId, '❌ Ошибка обновления баланса.');
          const errorMessage = `❌ Ошибка обновления баланса\n👤 Пользователь: ${userChatId}\n👮 Администратор: ${adminId}\n💳 Сумма: ${paymentAmount} руб.`;
          const adminPromises = adminChatIds.map(adminId => 
              sendTelegramNotification(adminId, errorMessage)
          );
          Promise.all(adminPromises);
          console.error(`❌ Ошибка обновления баланса для пользователя ${userChatId}:`, err);
        });
    });
  }

  // Всегда отвечаем на callback_query
  bot.answerCallbackQuery(query.id);
});

// Помощь
function help(chatId) {
  db.query('SELECT `data` FROM `todo` WHERE `name` = "howto" LIMIT 1', (err, results) => {
    if (err) {
      console.error('Ошибка при получении помощи из БД:', err);
      bot.sendMessage(chatId, 'Произошла ошибка при получении данных помощи.');
      return;
    }

    if (results.length === 0) {
      bot.sendMessage(chatId, 'Информация помощи не найдена.');
      return;
    }

    let helpText = results[0].data;

    // Заменяем <br>, <br/>, <br /> на перенос строки
    helpText = helpText.replace(/<br\s*\/?>/gi, '\n');

    // Получаем контакты поддержки из БД
    db.query('SELECT `data` FROM `settings` WHERE `name` = "helnames"', (helpErr, helpResults) => {
      let supportSection = '';
      
      if (!helpErr && helpResults.length > 0) {
        const helpData = helpResults[0].data;
        if (helpData && helpData.trim() !== '') {
          // Разделяем контакты по запятой и форматируем
          const contacts = helpData.split(',').map(contact => contact.trim()).filter(contact => contact !== '');
          if (contacts.length > 0) {
            const contactsText = contacts.map(contact => {
              // Если контакт начинается с @, делаем его кликабельным
              if (contact.startsWith('@')) {
                return contact;
              } else if (contact.startsWith('https://t.me/')) {
                const username = contact.replace('https://t.me/', '@');
                return username;
              } else {
                return contact;
              }
            }).join(' или ');

            supportSection = `\n\n👨‍💻 Для получения помощи обратитесь к: ${contactsText}`;
          }
        }
      }

      // Если контакты не найдены, используем значение по умолчанию
      if (!supportSection) {
        supportSection = '\n\n👨‍💻 *Для получения помощи обратитесь к:* @admin';
      }

      // Добавляем раздел поддержки к основному тексту
      const fullHelpText = helpText + supportSection;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
          ]
        },
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };

      bot.sendMessage(chatId, fullHelpText, options);
    });
  });
}

function payment(chatId) {
  // Сначала получаем балансы пользователя
  db.query('SELECT balance, ref_balance FROM users WHERE chatId = ?', [chatId], (err, results) => {
    if (err || results.length === 0) {
      bot.sendMessage(chatId, '❌ Ошибка получения данных.');
      return;
    }

    const user = results[0];
    const balance = Number(user.balance).toFixed(2);
    const refBalance = Number(user.ref_balance).toFixed(2);

    const message = `💳 *Пополнение баланса*

💰 Основной баланс: *${balance} руб.*
🤝 Реферальный баланс: *${refBalance} руб.*

Выберите способ оплаты:`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Банковская карта', callback_data: 'payment_ac' },
          ],
          [
            { text: '📲 СБП', callback_data: 'payment_sbp' },
          ],
          [
            { text: `🤝 Оплатить с реферального баланса (${refBalance}₽)`, callback_data: 'payment_ref' }
          ],
          [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
        ]
      },
      parse_mode: 'Markdown'
    };

    bot.sendMessage(chatId, message, options);
  });
}

// Оплата по карте
const userStates = {};

function payment_ac(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'payment' }]]
    }
  };

  userStates[chatId] = 'awaiting_card_amount';

  bot.sendMessage(chatId, '💳 Оплата банковской картой.\nВведите сумму платежа без копеек:', options);
};

// Оплата с реферального баланса
function payment_ref(chatId) {
  // Получаем данные пользователя
  db.query('SELECT balance, ref_balance FROM users WHERE chatId = ?', [chatId], (err, results) => {
    if (err || results.length === 0) {
      bot.sendMessage(chatId, '❌ Ошибка получения данных.');
      return;
    }

    const user = results[0];
    const refBalance = Number(user.ref_balance);
    
    if (refBalance <= 0) {
      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🤝 Пригласить друзей', callback_data: 'referral' }],
            [{ text: '💳 Другие способы оплаты', callback_data: 'payment' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
          ]
        }
      };
      
      bot.sendMessage(chatId, 
        `❌ На вашем реферальном балансе недостаточно средств.\n\n` +
        `💰 Реферальный баланс: ${refBalance.toFixed(2)} руб.\n\n` +
        `💡 *Как пополнить реферальный баланс:*\n` +
        `• Приглашайте друзей по реферальной ссылке\n` +
        `• За каждого приглашенного друга начисляется бонус\n` +
        `• Используйте средства для оплаты подписок`,
        options
      );
      return;
    }

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад', callback_data: 'payment' }]
        ]
      }
    };

    bot.sendMessage(chatId, 
      `🤝 *Оплата с реферального баланса*\n\n` +
      `💰 Доступно: *${refBalance.toFixed(2)} руб.*\n\n` +
      `💡 *Как это работает:*\n` +
      `• Средства спишутся с реферального баланса\n` +
      `• Основной баланс не изменится\n` +
      `• После оплаты вы сможете активировать подписки\n\n` +
      `Введите сумму для оплаты (максимум ${refBalance.toFixed(2)} руб.):`,
      options
    );

    // Сохраняем состояние для ожидания ввода суммы
    userStates[chatId] = 'awaiting_ref_amount';
  });
}

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
  } else if (state === 'awaiting_ref_amount') {
    console.log(`🔄 Обработка оплаты с реф. баланса для ${chatId}`);
    
    const amountText = msg.text.trim();
    const amount = parseFloat(amountText);

    // ПРОВЕРКА ВАЛИДНОСТИ СУММЫ
    if (isNaN(amount) || amount <= 0) {
      console.log(`❌ Неверная сумма: ${amountText}`);
      return bot.sendMessage(chatId, '❌ Пожалуйста, введите корректную сумму (только цифры).');
    }

    // Получаем текущий реферальный баланс
    console.log(`📊 Получаем баланс для ${chatId}`);
    db.query('SELECT ref_balance, name FROM users WHERE chatId = ?', [chatId], (err, results) => {
      if (err) {
        console.error('❌ Ошибка БД при получении баланса:', err);
        bot.sendMessage(chatId, '❌ Ошибка получения данных баланса.');
        userStates[chatId] = null;
        return;
      }

      if (results.length === 0) {
        console.error(`❌ Пользователь ${chatId} не найден в БД`);
        bot.sendMessage(chatId, '❌ Пользователь не найден.');
        userStates[chatId] = null;
        return;
      }

      const currentRefBalance = Number(results[0].ref_balance);
      const userName = results[0].name || `Пользователь ${chatId}`;

      console.log(`💰 Текущий реф. баланс: ${currentRefBalance}, запрошено: ${amount}`);

      if (amount > currentRefBalance) {
        console.log(`❌ Недостаточно средств: ${amount} > ${currentRefBalance}`);
        bot.sendMessage(chatId, 
          `❌ Недостаточно средств на реферальном балансе.\n\n` +
          `💸 Запрошено: ${amount.toFixed(2)} руб.\n` +
          `💰 Доступно: ${currentRefBalance.toFixed(2)} руб.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Попробовать снова', callback_data: 'payment_ref' }],
                [{ text: '🔙 Назад к оплате', callback_data: 'payment' }]
              ]
            }
          }
        );
        userStates[chatId] = null;
        return;
      }

      // Списание с реферального баланса и пополнение основного
      const newRefBalance = currentRefBalance - amount;
      console.log(`💸 Списание: ${currentRefBalance} - ${amount} = ${newRefBalance}`);

      const newBalanceQuery = `
        UPDATE users 
        SET ref_balance = ?, 
            balance = balance + ?,
            lastPaymentDate = NOW(),
            paymentAmount = ?,
            adminWhoBill = 'ref_system'
        WHERE chatId = ?
      `;

      db.query(newBalanceQuery, [newRefBalance, amount, amount, chatId], (updateErr, updateResults) => {
        userStates[chatId] = null;

        if (updateErr) {
          console.error('❌ Ошибка обновления баланса в БД:', updateErr);
          bot.sendMessage(chatId, '❌ Произошла ошибка при списании средств.');
          return;
        }

        console.log(`✅ Баланс успешно обновлен в БД`);

        // СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЮ
        const successMessage = 
          `✅ *Оплата успешно выполнена!*\n\n` +
          `💸 Сумма оплаты: *${amount.toFixed(2)} руб.*\n` +
          `🤝 Списано с реферального баланса\n\n` +
          `💰 Новый реферальный баланс: *${newRefBalance.toFixed(2)} руб.*\n` +
          `💳 Основной баланс пополнен на: *${amount.toFixed(2)} руб.*\n\n` +
          `💫 Теперь вы можете активировать подписки в разделе "📱 Мои подписки"`;

        const options = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Активировать подписки', callback_data: 'devices' }],
              [{ text: '💳 Пополнить еще', callback_data: 'payment' }],
              [{ text: '🔙 Главное меню', callback_data: 'back_to_main' }]
            ]
          },
          parse_mode: 'Markdown'
        };

        console.log(`📨 Отправляем сообщение пользователю ${chatId}`);
        bot.sendMessage(chatId, successMessage, options)
          .then(() => {
            console.log(`✅ Сообщение пользователю отправлено`);
          })
          .catch(error => {
            console.error('❌ Ошибка отправки сообщения пользователю:', error);
          });

        // УВЕДОМЛЕНИЕ АДМИНИСТРАТОРОВ - УПРОЩЕННАЯ ВЕРСИЯ
        const adminMessage = 
          `💸 *Оплата с реферального баланса*\n\n` +
          `👤 Пользователь: ${userName}\n` +
          `🆔 ID: ${chatId}\n` +
          `💳 Сумма: ${amount.toFixed(2)} руб.\n` +
          `🤝 Тип: Реферальный баланс\n` +
          `💰 Было: ${currentRefBalance.toFixed(2)} руб.\n` +
          `💰 Стало: ${newRefBalance.toFixed(2)} руб.\n` +
          `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        console.log(`📢 Отправляем уведомления администраторам:`, adminChatIds);
        
        // Простая отправка без ожидания Promise
        adminChatIds.forEach(adminId => {
          console.log(`📨 Отправляем админу ${adminId}`);
          sendTelegramNotification(adminId, adminMessage)
            .then(() => {
              console.log(`✅ Уведомление отправлено админу ${adminId}`);
            })
            .catch(error => {
              console.error(`❌ Ошибка отправки админу ${adminId}:`, error);
            });
        });

        // ДОПОЛНИТЕЛЬНО: Проверяем обновленный баланс
        setTimeout(() => {
          db.query('SELECT balance, ref_balance FROM users WHERE chatId = ?', [chatId], (checkErr, checkResults) => {
            if (!checkErr && checkResults.length > 0) {
              console.log(`🔍 Проверка баланса после операции:`);
              console.log(`   - Основной: ${checkResults[0].balance}`);
              console.log(`   - Реферальный: ${checkResults[0].ref_balance}`);
            }
          });
        }, 1000);
      });
    });
  }
});

// Оплата по СБП
function payment_sbp(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'payment' }]]
    }
  };
  bot.sendMessage(chatId, `📱 Оплата производится через СБП.\nВведите сумму платежа без копеек:`, options);

  bot.once('message', async (msg) => {
    const amount = msg.text;

    if (!/^\d+$/.test(amount)) {
      return bot.sendMessage(chatId, '❌ Пожалуйста, введите корректную сумму (только цифры).');
    }

    try {
      const requestData = {
        chatId: String(chatId),
        amount: Number(amount) * 100
      };

      const response = await axios.post('http://127.0.0.1:3302/', requestData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const { payload, qrcId, image } = response.data.bankResponse.Data;

      const paymentMessage = `🔗 Ссылка на оплату: ${payload}`;

      bot.sendMessage(chatId, paymentMessage);

      const backOptions = {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'payment' }]]
        }
      };
      bot.sendMessage(chatId, 'Для возврата в главное меню нажмите кнопку "Назад".', backOptions);

    } catch (error) {
      console.error('Ошибка при отправке данных в API:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка при отправке данных. Попробуйте ещё раз.');
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
              { text: '✏️ Изменить имя', callback_data: 'edit_name' },
              { text: '📞 Изменить телефон', callback_data: 'edit_phone' }
            ],
            [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
          ]
        }
      };

      const profile = `👤 Ваши данные\n\nИмя: ${user.name || 'не указано'}\nТелефон: ${user.phone || 'не указан'}`;
      bot.sendMessage(chatId, profile, options);
    } else {
      bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }
  });
}

// ФУНКЦИЯ РЕГИСТРАЦИИ С ИЗВЛЕЧЕНИЕМ ПОЛНОГО ИМЕНИ И ТЕЛЕФОНА
async function register(chatId, referrerId = null, msg = null) {
  console.log(`🔄 Начало регистрации для ${chatId}, реферер: ${referrerId}`);
  
  // ПРОВЕРКА: Уже зарегистрирован?
  db.query('SELECT * FROM users WHERE chatId = ?', [chatId], (err, existingUsers) => {
    if (err) {
      console.error('❌ Ошибка проверки пользователя:', err);
      bot.sendMessage(chatId, '❌ Произошла ошибка при проверке регистрации.');
      return;
    }

    // Если УЖЕ зарегистрирован
    if (existingUsers.length > 0) {
      console.log(`⚠️ Пользователь ${chatId} уже зарегистрирован`);
      
      if (referrerId) {
        bot.sendMessage(chatId, 
          '❌ Вы уже зарегистрированы в системе.\n' +
          'Реферальная ссылка может быть использована только новыми пользователями.'
        );
      } else {
        bot.sendMessage(chatId, '✅ Вы уже зарегистрированы!');
      }
      showMainMenu(chatId);
      return;
    }

    // ЕЩЕ НЕ ЗАРЕГИСТРИРОВАН - продолжаем регистрацию
    console.log(`✅ Новый пользователь ${chatId}, начинаем регистрацию`);

    const planId = 2;
    const registrationDate = moment().format('YYYY-MM-DD HH:mm:ss');
    const lastPaymentDate = registrationDate;
    const lastBillDate = registrationDate;

    // Получаем стартовый баланс и реферальный бонус из тарифа
    db.query('SELECT `start`, `ref_start`, `start_ref_bal` FROM `plans` WHERE `id` = ?', [planId], (err, planResults) => {
      if (err || planResults.length === 0) {
        console.error('❌ Ошибка получения тарифа:', err);
        bot.sendMessage(chatId, '❌ Ошибка при получении данных тарифа.');
        return;
      }

      // Определяем стартовый баланс: если есть реферер - используем start_ref_bal, иначе start
      const startAmount = referrerId ? (planResults[0].start_ref_bal || planResults[0].start) : planResults[0].start;
      const refBonus = planResults[0].ref_start || 0;

      console.log(`💰 Данные тарифа: 
        - Обычный стартовый баланс = ${planResults[0].start}
        - Реферальный стартовый баланс = ${planResults[0].start_ref_bal}
        - Используется = ${startAmount}
        - Реферальный бонус = ${refBonus}`);

      // Генерируем реферальную ссылку для нового пользователя
      const refUrl = crypto.randomBytes(4).toString('hex');
      console.log(`🔗 Сгенерирован ref_url для ${chatId}: ${refUrl}`);

      // ПОЛУЧАЕМ ДАННЫЕ ПРИГЛАСИТЕЛЯ (для красивого отображения)
      let referrerName = 'Неизвестный';
      let referrerInfo = '';
      
      if (referrerId) {
        db.query('SELECT name, chatId FROM users WHERE chatId = ?', [referrerId], (refErr, referrerResults) => {
          if (!refErr && referrerResults.length > 0) {
            referrerName = referrerResults[0].name || `пользователь ${referrerResults[0].chatId}`;
            referrerInfo = `👥 Вас пригласил: ${referrerName}\n`;
            console.log(`👤 Найден пригласитель: ${referrerName} (${referrerId})`);
          } else {
            console.log(`⚠️ Пригласитель ${referrerId} не найден в базе`);
            referrerId = null; // Обнуляем если пригласитель не найден
          }
          completeRegistration();
        });
      } else {
        completeRegistration();
      }

      function completeRegistration() {
        // ИСПРАВЛЕННОЕ ИЗВЛЕЧЕНИЕ ИМЕНИ ПОЛЬЗОВАТЕЛЯ ИЗ TELEGRAM API
        let userName = `Пользователь ${chatId}`;
        
        // Получаем информацию о пользователе из Telegram API
        bot.getChat(chatId)
          .then(userInfo => {
            console.log('📋 Данные пользователя из Telegram API:', JSON.stringify(userInfo, null, 2));
            
            // Извлекаем имя из данных пользователя
            if (userInfo.first_name && userInfo.last_name) {
              userName = `${userInfo.first_name} ${userInfo.last_name}`;
              console.log(`✅ Извлечено полное имя: ${userName}`);
            } else if (userInfo.first_name) {
              userName = userInfo.first_name;
              console.log(`✅ Извлечено имя: ${userName}`);
            } else if (userInfo.username) {
              userName = userInfo.username;
              console.log(`✅ Использован username: ${userName}`);
            } else {
              console.log(`⚠️ Минимальные данные, используем ID: ${userName}`);
            }
            
            // Продолжаем регистрацию с полученным именем
            finishRegistration(userName);
          })
          .catch(error => {
            console.error('❌ Ошибка получения данных пользователя из Telegram:', error);
            // Если не удалось получить данные, используем стандартное имя
            finishRegistration(userName);
          });

        function finishRegistration(userName) {
          // ИЗВЛЕКАЕМ НОМЕР ТЕЛЕФОНА (если есть)
          let userPhone = null;
          if (msg && msg.contact) {
            userPhone = msg.contact.phone_number;
            console.log(`📞 Извлечен номер телефона: ${userPhone}`);
          }

          console.log(`📝 Регистрируем пользователя:
          - ID: ${chatId}
          - Имя: ${userName}
          - Телефон: ${userPhone}
          - Пригласитель: ${referrerId || 'нет'}
          - Тариф: ${planId}
          - Баланс: ${startAmount} ${referrerId ? '(реферальный бонус)' : ''}
          - Реферальный бонус пригласителю: ${refBonus}₽`);

          // SQL запрос для создания пользователя
          const query = `
            INSERT INTO users 
            (chatId, ref_url, phone, lang, name, invited_by, registrationDate, lastPaymentDate, paymentAmount, balance, ref_balance, lastBillDate, locked, lockedDate, files, plan_id, \`NL\`, \`DE\`, admin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const values = [
            chatId,           // chatId нового пользователя
            refUrl,           // его реферальная ссылка
            userPhone,        // телефон
            null,             // язык
            userName,         // полное имя
            referrerId,       // invited_by - ID пригласителя (ВАЖНО!)
            registrationDate, // дата регистрации
            lastPaymentDate,  // последний платеж
            startAmount,      // сумма платежа
            startAmount,      // баланс
            0,                // реферальный баланс
            lastBillDate,     // дата последнего списания
            0,                // заблокирован?
            lastPaymentDate,  // дата блокировки
            null,             // файлы
            planId,           // тариф
            '0',              // NL подписка
            '0',              // DE подписка  
            0                 // не админ
          ];

          // Сохраняем пользователя в базу
          db.query(query, values, (err) => {
            if (err) {
              console.error('❌ Ошибка сохранения в БД:', err);
              bot.sendMessage(chatId, 
                '❌ Произошла ошибка при регистрации.\n' +
                'Пожалуйста, попробуйте еще раз или обратитесь в поддержку.'
              );
              return;
            }

            console.log(`✅ Пользователь ${chatId} успешно сохранен в БД`);

            // СООБЩЕНИЕ НОВОМУ ПОЛЬЗОВАТЕЛЮ
            let welcomeMessage = '✅ Вы успешно зарегистрированы!\n\n';
            
            if (referrerId) {
              welcomeMessage += referrerInfo + '\n';
              welcomeMessage += `🎉 Вам начислен увеличенный стартовый бонус ${startAmount}₽ за регистрацию по приглашению!`;
            } else {
              welcomeMessage += `💫 Добро пожаловать в нашу систему! На ваш баланс начислено ${startAmount}₽.`;
            }
            
            bot.sendMessage(chatId, welcomeMessage);

            // НАЧИСЛЯЕМ БОНУС ПРИГЛАСИТЕЛЮ (если есть реферер И бонус больше 0)
            if (referrerId && refBonus > 0) {
              console.log(`💰 Начисляем реферальный бонус ${refBonus}₽ пригласителю ${referrerId}`);
              
              db.query(
                'UPDATE users SET ref_balance = ref_balance + ? WHERE chatId = ?',
                [refBonus, referrerId],
                (refErr) => {
                  if (refErr) {
                    console.error('❌ Ошибка начисления бонуса рефереру:', refErr);
                  } else {
                    console.log(`✅ Реферальный бонус ${refBonus}₽ начислен пользователю ${referrerId}`);
                    
                    // Сообщение пригласителю
                    const refMessage = 
                      `🎉 По вашей ссылке зарегистрировался новый пользователь!\n\n` +
                      `👤 Имя: ${userName}\n` +
                      `🆔 ID: ${chatId}\n` +
                      `📞 Телефон: ${userPhone || 'не указан'}\n` +
                      `💳 Новый пользователь получил: ${startAmount}₽\n` +
                      `💸 Вам начислено: ${refBonus}₽ на реферальный баланс.\n\n` +
                      `💳 Перейдите в раздел "🤝 Рефералка", чтобы перевести средства на основной баланс.`;
                    
                    bot.sendMessage(referrerId, refMessage);
                  }
                }
              );
            } else if (referrerId && refBonus <= 0) {
              console.log(`ℹ️ Реферальный бонус не начислен (refBonus = ${refBonus})`);
            }

            // УВЕДОМЛЯЕМ АДМИНИСТРАТОРОВ
            const adminMessage = 
              `👤 Новый пользователь зарегистрирован:\n` +
              `🆔 chatId: ${chatId}\n` +
              `📛 Имя: ${userName}\n` +
              `📞 Телефон: ${userPhone || '—'}\n` +
              `👥 Пригласил: ${referrerId ? `${referrerName} (ID: ${referrerId})` : '—'}\n` +
              `📦 Тариф: #${planId}\n` +
              `💰 Баланс: ${startAmount} ${referrerId ? '(реферальный бонус)' : ''}\n` +
              `🎯 Реферальный бонус пригласителю: ${refBonus}₽`;

            console.log(`📢 Отправляем уведомления администраторам`);
            adminChatIds.forEach(adminId => {
              console.log(`📨 Админ ${adminId}: уведомление отправлено`);
              sendTelegramNotification(adminId, adminMessage);
            });

            // ПОКАЗЫВАЕМ ГЛАВНОЕ МЕНЮ
            console.log(`🏠 Показываем главное меню для ${chatId}`);
            showMainMenu(chatId);
          });
        }
      }
    });
  });
}

function devices(chatId) {
  db.query('SELECT `NL`, `DE` FROM users WHERE chatId = ?', [chatId], (err, results) => {
    if (err) {
      bot.sendMessage(chatId, '❌ Произошла ошибка при получении данных устройств.');
      console.log('❌ Произошла ошибка при получении данных устройств.');
      return;
    }

    console.log('Вызвана функция devices для chatId:', chatId);

    if (results.length > 0) {
      const userDevices = results[0];
      const deviceButtons = [];

      Object.keys(userDevices).forEach((deviceKey) => {
        const deviceValue = userDevices[deviceKey];

        if (deviceValue && deviceValue !== '0') {
          const deviceName = deviceKey === 'NL' ? '🇳🇱 Нидерланды' : '🇩🇪 Германия';
          deviceButtons.push([
            { text: `${deviceName}`, callback_data: `view_${deviceKey}` },
            { text: `🗑️ Удалить`, callback_data: `delete_${deviceKey}` }
          ]);
        } else {
          const deviceName = deviceKey === 'NL' ? '🇳🇱 Нидерланды' : '🇩🇪 Германия';
          deviceButtons.push([
            { text: `➕ ${deviceName}`, callback_data: `add_${deviceKey}` }
          ]);
        }
      });

      deviceButtons.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

      const options = {
        reply_markup: {
          inline_keyboard: deviceButtons
        }
      };

      const activeSubscriptions = Object.values(userDevices).filter(val => val && val !== '0').length;
      const message = `📱 Ваши подписки\n\nАктивных подписок: ${activeSubscriptions}/2\n\nВыберите действие:`;
      
      bot.sendMessage(chatId, message, options);
    } else {
      bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }
  });
}

// Обработчик команды /admin с проверкой прав администратора
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;

  isAdmin(chatId)
    .then(isAdminUser => {
      if (isAdminUser) {
        admin(chatId);
      } else {
        bot.sendMessage(chatId, '❌ У вас нет прав для доступа к этой команде.');
      }
    })
    .catch(error => {
      console.error('Ошибка проверки прав администратора:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка при проверке ваших прав. Пожалуйста, попробуйте позже.');
    });
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
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

// Функция для получения пользователя по chatId
function getUserByChatId(chatId) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT * FROM users WHERE chatId = ?';
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

// Функция для получения пользователей
function getUsers(offset, limit) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT chatId, name, balance, locked, `NL`, `DE`, adminWhoBill FROM users LIMIT ? OFFSET ?';
    db.query(query, [limit, offset], (err, results) => {
      if (err) {
        console.error('Ошибка выполнения запроса к базе данных:', err);
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
}

// Функция для обновления баланса пользователя
function updateBalance(chatId, paymentAmount, adminId) {
  return new Promise((resolve, reject) => {
    getUserByChatId(chatId)
      .then(user => {
        const newBalance = parseFloat(user.balance) + paymentAmount;

        const query = `
          UPDATE users 
          SET balance = ?, lastPaymentDate = NOW(), paymentAmount = ?, adminWhoBill = ?
          WHERE chatId = ?`;

        db.query(query, [newBalance, paymentAmount, adminId, chatId], (err) => {
          if (err) {
            console.error('Ошибка обновления баланса:', err);
            reject(err);
          } else {
            const message = `✅ Ваш баланс успешно обновлен!\nНовая сумма: ${newBalance.toFixed(2)} руб.\nСумма платежа: ${paymentAmount.toFixed(2)} руб.\n\nСпасибо за пополнение!`;
            bot.sendMessage(chatId, message)
            resolve(newBalance);
          }
        });
      })
      .catch(reject);
  });
}

// Функция admin
function admin(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Список пользователей', callback_data: 'user_list_0' }],
        [{ text: '👤 Данные пользователя', callback_data: 'user_data' }],
        [{ text: '🔙 Меню пользователя', callback_data: 'back_to_main' }]
      ]
    }
  };
  bot.sendMessage(chatId, '⚙️ Панель администратора\n\nВыберите действие:', options);
}

// Обновляем список админов каждые 5 минут
cron.schedule('*/5 * * * *', loadAdminChatIds);