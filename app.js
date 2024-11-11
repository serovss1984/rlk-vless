const express = require('express');
const billing = require('./biling');
const bot = require('./bot');  // Подключаем бот

const app = express();

// Запуск биллинга
require('./biling');  // Это автоматически будет запускать биллинг

app.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});
