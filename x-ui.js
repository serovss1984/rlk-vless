const axios = require('axios');
const qs = require('qs');
const http = require('http');

const data = qs.stringify({
  username: 'GG6UFOIatP', // ваш логин
  password: 'joEcafmh9k'  // ваш пароль
});

// Создаем HTTP-агент с явным указанием версии протокола
const agent = new http.Agent({
  keepAlive: true,
});

const config = {
  method: 'post',
  url: 'http://nl-del.rollyk.ru:2053/login',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  data: data,
  httpAgent: agent, // Указываем агент для использования HTTP/1.1
};

axios(config)
  .then(function (response) {
    console.log('Login response:', JSON.stringify(response.data));
    
    // Получаем куки из заголовков ответа
    const cookies = response.headers['set-cookie'];
    console.log('Cookies received:', cookies);

    if (cookies && cookies.length > 0) {
      const sessionCookie = cookies[0].split(';')[0];
      console.log('Using session cookie:', sessionCookie);
      
      // Переходим к запросу списка inbound с сессионной кукой
      getInbounds(sessionCookie);
    } else {
      console.error('No cookies received');
    }
  })
  .catch(function (error) {
    console.error('Login error:', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    }
  });

// Функция для получения списка inbound с использованием сессионной куки
function getInbounds(sessionCookie) {
  const config = {
    method: 'get',
    url: 'http://nl-del.rollyk.ru:2053/panel/api/inbounds/list',
    headers: {
      'Accept': 'application/json',
      'Cookie': sessionCookie,
    },
    httpAgent: agent, // Используем HTTP-агент и здесь
  };

  axios(config)
    .then(function (response) {
      console.log('Inbound List:', JSON.stringify(response.data, null, 2));
    })
    .catch(function (error) {
      console.error('Error fetching inbound list:', error.message);
      if (error.response) {
        console.error('Error response data:', error.response.data);
      }
    });
}
