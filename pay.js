const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();

// Для парсинга JSON-тел запроса
app.use(bodyParser.json());

// Маршрут для получения уведомлений от Юмани
app.post('/pay', (req, res) => {
    const notificationData = req.body;

    // Логируем полученные данные в файл
    const logMessage = `${new Date().toISOString()} - Получено уведомление: ${JSON.stringify(notificationData)}\n`;

    fs.appendFile('payment_notifications.log', logMessage, (err) => {
        if (err) {
            console.error('Ошибка при записи в файл:', err);
            return res.status(500).send('Ошибка при записи данных');
        }

        console.log('Уведомление записано в файл');
	console.log(notificationData);
        res.status(200).send('Уведомление получено');
    });
});

// Запуск сервера
const port = 3000;
app.listen(port, () => {
    console.log(`API сервер работает на порту ${port}`);
});
