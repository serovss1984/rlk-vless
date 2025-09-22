const mysql = require('mysql2');
require('dotenv').config();

//Создаем пул соединений
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,  // Максимальное число соединений
  queueLimit: 0         // Без ограничения очереди
});

// Проверяем подключение
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Ошибка подключения к базе данных:', err);
    process.exit(1);
  }
  console.log('Успешно подключено к базе данных');
  connection.release(); // Освобождаем соединение
});

module.exports = pool;
