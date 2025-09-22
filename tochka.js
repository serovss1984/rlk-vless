const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3302;

app.use(bodyParser.json());

// API для обработки запросов
app.post('/', async (req, res) => {
    const { chatId, amount } = req.body;

    if (!chatId || !amount) {
        return res.status(400).json({ error: 'chatId и amount обязательны' });
    }

    console.log(`Получены данные: chatId=${chatId}, amount=${amount}`);

    // Формируем тело запроса для банка
    const requestBody = {
        Data: {
            amount: amount,
            currency: "RUB",
            paymentPurpose: chatId,
            qrcType: "02",
            imageParams: {
                width: 200,
                height: 200,
                mediaType: "image/png"
            },
            sourceName: "string",
            ttl: "10",
            redirectUrl: "https://rollyk.ru/payok"
        }
    };

    // Логируем тело запроса
    console.log('Тело запроса в банк:', JSON.stringify(requestBody, null, 2));

    // Формируем заголовки
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TOCHKA_TOCKEN}`
    };

    // Логируем заголовки
    console.log('Заголовки запроса:', headers);

    try {
        const response = await axios.post(
            `https://enter.tochka.com/uapi/sbp/v1.0/qr-code/merchant/${process.env.TOCHKA_MERCHANTID}/${process.env.TOCHKA_ACCOUTID}/044525104`,
            requestBody,
            { headers }
        );

        console.log('Ответ от банка:', response.data);
        res.json({ status: 'ok', message: 'Данные приняты и отправлены в банк', bankResponse: response.data });
    } catch (error) {
        console.error('Ошибка при отправке данных в банк:');
        if (error.response) {
            // Логируем ответ от сервера, если он есть
            console.error('Статус ошибки:', error.response.status);
            console.error('Данные ошибки:', error.response.data);
        } else if (error.request) {
            // Логируем запрос, если ответа не было
            console.error('Запрос был отправлен, но ответ не получен:', error.request);
        } else {
            // Логируем другие ошибки
            console.error('Ошибка:', error.message);
        }
        res.status(500).json({ error: 'Ошибка при отправке данных в банк' });
    }
});

// Запуск сервера на localhost
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Сервер слушает http://127.0.0.1:${PORT}`);
});