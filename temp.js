const axios = require('axios');
require('dotenv').config();

// Путь к серверу
const baseURL = 'http://127.0.0.1:2053';

// Данные для авторизации из .env
const username = process.env.USERNAME;
const password = process.env.PASSWORD;

// Функция авторизации
async function login() {
  console.log('Attempting to login...');
  try {
    const response = await axios.post(
      `${baseURL}/login`,
      new URLSearchParams({
        username: username,
        password: password
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log('Login response:', response.data);
    
    const cookies = response.headers['set-cookie'];
    console.log('Cookies received:', cookies);

    if (cookies && cookies.length >= 2) {
      // Используем вторую куку
      const sessionCookie = cookies[1].split(';')[0];
      console.log('Using session cookie:', sessionCookie);
      return sessionCookie;
    } else {
      console.error('Required session cookie not found');
      return null;
    }
  } catch (error) {
    console.error('Login error:', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    }
  }
}

// Функция для получения списка inbound с использованием сессионной куки
async function getInbounds(sessionCookie) {
  console.log('Attempting to fetch inbound list...');
  try {
    const response = await axios.get(`${baseURL}/panel/api/inbounds/list`, {
      headers: {
        'Accept': 'application/json',
        'Cookie': sessionCookie,
      },
    });
    console.log('Inbound List:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error fetching inbound list:', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    }
  }
}

// Основная функция для выполнения логина и получения списка inbound
(async () => {
  console.log('Starting main process...');
  const sessionCookie = await login();
  if (sessionCookie) {
    console.log('Login successful. Proceeding to fetch inbounds...');
    await getInbounds(sessionCookie);
  } else {
    console.error('Login failed. Cannot proceed to fetch inbounds.');
  }
})();
