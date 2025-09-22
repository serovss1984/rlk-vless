process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid'); // добавляем в начало файла

const app = express();
const PORT = 3332;

// --- Читаем из env сразу несколько конфигов ---
const SERVER_CONFIGS = {
  NL: {
    PANEL_URL: process.env.PANEL_URL_NL,
    LOGIN_USERNAME: process.env.LOGIN_USERNAME_NL,
    LOGIN_PASSWORD: process.env.LOGIN_PASSWORD_NL,
    INBOUND_ID: parseInt(process.env.INBOUND_ID_NL, 10)
  },
  DE: {
    PANEL_URL: process.env.PANEL_URL_DE,
    LOGIN_USERNAME: process.env.LOGIN_USERNAME_DE,
    LOGIN_PASSWORD: process.env.LOGIN_PASSWORD_DE,
    INBOUND_ID: parseInt(process.env.INBOUND_ID_DE, 10)
  }
};

// --- Функция для выбора конфига по суффиксу email ---
function getServerConfigBySuffix(email) {
  if (email.endsWith('-1')) return SERVER_CONFIGS.NL;
  if (email.endsWith('-5')) return SERVER_CONFIGS.DE;
  // Можно добавить другие варианты или дефолт
  return SERVER_CONFIGS.NL; // по умолчанию NL
}


const SERVER_STATES = {
  NL: {
    cookie: null,
    lastLoginTime: null
  },
  DE: {
    cookie: null,
    lastLoginTime: null
  }
};

// --- Перепишем loginToPanel, чтобы принимал config ---
async function loginToPanel(config) {
  const serverKey = config === SERVER_CONFIGS.NL ? 'NL' : 'DE';
  const serverState = SERVER_STATES[serverKey];
  
  try {
    console.log(`🔐 Попытка авторизации в 3x-ui (${config.PANEL_URL})...`);
    const res = await axios.post(`${config.PANEL_URL}/login`, {
      username: config.LOGIN_USERNAME,
      password: config.LOGIN_PASSWORD
    }, {
      withCredentials: true
    });

    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      serverState.cookie = setCookie.map(c => c.split(';')[0]).join('; ');
      serverState.lastLoginTime = Date.now();
      console.log(`✅ Авторизация успешна на сервере ${serverKey}. Cookie сохранена.`);
    } else {
      console.error('❌ Авторизация прошла, но cookie не получена.');
    }
  } catch (err) {
    console.error('❌ Ошибка при авторизации в панель:', err.response?.data || err.message);
    throw err;
  }
}

// --- fetchWithAuth теперь принимает config и делает login по нужному конфигу ---
async function fetchWithAuth(config, serverConfig) {
  const serverKey = serverConfig === SERVER_CONFIGS.NL ? 'NL' : 'DE';
  const serverState = SERVER_STATES[serverKey];
  
  config.headers = config.headers || {};
  config.headers.Cookie = serverState.cookie;

  try {
    const response = await axios(config);
    return response;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      console.warn('⚠️ Cookie истекла, повторная авторизация...');
      await loginToPanel(serverConfig);
      config.headers.Cookie = SERVER_STATES[serverKey].cookie;
      return axios(config);
    } else {
      throw err;
    }
  }
}

// --- Получение клиента ---
app.get('/client/:email', async (req, res) => {
  const email = req.params.email;
  console.log(`🔎 Поиск клиента по email: ${email}`);

  // Выбираем конфиг в зависимости от суффикса
  const serverConfig = getServerConfigBySuffix(email);

  try {
    const respDetail = await fetchWithAuth({
      method: 'GET',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/get/${serverConfig.INBOUND_ID}`
    }, serverConfig);

    const fullInbound = respDetail.data.obj;

    let parsedSettings = {};
    try {
      parsedSettings = JSON.parse(fullInbound.settings);
    } catch (e) {
      console.error('❌ Ошибка парсинга settings JSON:', e.message);
    }

    const clients = parsedSettings.clients || [];
    console.log(`👥 Клиенты в inbound ID=${serverConfig.INBOUND_ID}: ${clients.map(c => c.email).join(', ')}`);

    const client = clients.find(c => c.email === email);
    if (client) {
      console.log(`✅ Найден клиент ${email}`);
      return res.json({
        ...client,
        inboundId: fullInbound.id,
        inboundRemark: fullInbound.remark
      });
    }

    console.warn(`❌ Клиент ${email} не найден`);
    res.status(404).json({ error: 'Client not found' });
  } catch (err) {
    console.error('❌ Ошибка при получении клиента:', err.response?.data || err.message);
    res.status(500).json({ error: 'Ошибка при получении клиента: ' + err.message });
  }
});

// --- Получаем uuid ---
app.get('/uuid/:email', async (req, res) => {
  const email = req.params.email;
  console.log(`🔎 Поиск клиента по email: ${email}`);

  const serverConfig = getServerConfigBySuffix(email);

  try {
    const respDetail = await fetchWithAuth({
      method: 'GET',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/get/${serverConfig.INBOUND_ID}`
    }, serverConfig);

    const fullInbound = respDetail.data.obj;

    let parsedSettings = {};
    try {
      parsedSettings = JSON.parse(fullInbound.settings);
    } catch (e) {
      console.error('❌ Ошибка парсинга settings JSON:', e.message);
    }

    const clients = parsedSettings.clients || [];
    const client = clients.find(c => c.email === email);

if (client) {
  console.log(`✅ Найден клиент ${email}, UUID: ${client.id}`);

  const suffixMatch = email.match(/-(\d+)$/);
  const suffix = suffixMatch ? suffixMatch[1] : '1';

  let urls = [];

  if (suffix === '1') { // NL
    const URL = generateVlessLink({
      clientId: client.id,
      host: 'vless.rollyk.ru',
      port: 40443,
      pbk: '31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0',
      comment: `NL-${email}`,
      flow: client.flow,
      sid: '7cec4a13b1c76360' // фиксированный NL
    });
    urls.push(URL);

  } else if (suffix === '5') { // DE
    const URL = generateVlessLink({
      clientId: client.id,
      host: 'de-fkf.rollyk.ru',
      port: 52848,
      pbk: '4MNUP5yofQO_mbHcMAIZFW4RpCBX6BqjAgisuSOGwjw',
      comment: `DE-${email}`,
      flow: client.flow,
      sid: '89af48' // фиксированный DE
    });
    urls.push(URL);
  }

  return res.json({ uuid: client.id, urls });
}

// Вспомогательная функция
function generateVlessLink({ clientId, host, port, pbk, comment, flow, sid }) {
  const fp = 'chrome';
  const sni = 'dl.google.com';
  const spx = '/';
  const usedFlow = flow || 'xtls-rprx-vision';

  return `vless://${clientId}@${host}:${port}?type=tcp&security=reality&pbk=${pbk}&fp=${fp}&sni=${sni}&sid=${sid}&spx=${encodeURIComponent(spx)}&flow=${usedFlow}#${comment}`;

  console.log('🔗 Сформирована ссылка:', URL);

  return res.json({ uuid: client.id, url: URL });
}

    console.warn(`❌ Клиент ${email} не найден`);
    res.status(404).json({ error: 'Client not found' });
  } catch (err) {
    console.error('❌ Ошибка при получении клиента:', err.response?.data || err.message);
    res.status(500).json({ error: 'Ошибка при получении клиента: ' + err.message });
  }
});


/** 🔄 Общая функция включения/отключения клиента */
async function setClientEnableStatus(email, enable, res) {
  console.log(`🔎 Поиск клиента по email: ${email}`);

  const serverConfig = getServerConfigBySuffix(email);

  try {
    const respDetail = await fetchWithAuth({
      method: 'GET',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/get/${serverConfig.INBOUND_ID}`
    }, serverConfig);

    const inbound = respDetail.data.obj;
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    let settings;
    try {
      settings = JSON.parse(inbound.settings);
    } catch (e) {
      console.error(`❌ Ошибка парсинга inbound.settings:`, e.message);
      return res.status(500).json({ error: 'Failed to parse inbound settings' });
    }

    const clients = settings.clients || [];
    const client = clients.find(c => c.email === email);

    if (!client) {
      console.warn(`❌ Клиент ${email} не найден в inbound ID=${inbound.id}`);
      return res.status(404).json({ error: `Client ${email} not found` });
    }

    console.log(`✅ Найден клиент ${email}, текущий enable: ${client.enable}`);

    // меняем enable
    client.enable = enable;

    const body = {
      id: inbound.id,
      settings: JSON.stringify({ clients: [client] })
    };

    console.log(`🔄 Отправляем updateClient для UUID=${client.id}`);

    const updateResp = await fetchWithAuth({
      method: 'POST',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/updateClient/${client.id}`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: body
    }, serverConfig);

    if (updateResp.data.success) {
      console.log(`✅ Статус клиента ${email} обновлён успешно`);
      return res.json({ success: true, message: `Client ${email} set to ${enable}` });
    } else {
      console.error(`❌ Ошибка обновления клиента:`, updateResp.data.msg);
      return res.status(500).json({ error: updateResp.data.msg || 'Unknown error' });
    }

  } catch (err) {
    console.error(`❌ Ошибка при обновлении клиента:`, err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
}

/** 🔌 Включить клиента */
app.put('/client/:email/enable', async (req, res) => {
  await setClientEnableStatus(req.params.email, true, res);
});

/** 🔌 Отключить клиента */
app.put('/client/:email/disable', async (req, res) => {
  await setClientEnableStatus(req.params.email, false, res);
});

/** 🗑 Удаление клиента по email */
app.delete('/delete/:email', async (req, res) => {
  const email = req.params.email;
  console.log(`🗑 Запрос на удаление клиента: ${email}`);

  const serverConfig = getServerConfigBySuffix(email);

  try {
    // Получаем inbound и ищем клиента
    const respDetail = await fetchWithAuth({
      method: 'GET',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/get/${serverConfig.INBOUND_ID}`
    }, serverConfig);

    const inbound = respDetail.data.obj;
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    let settings;
    try {
      settings = JSON.parse(inbound.settings);
    } catch (e) {
      console.error(`❌ Ошибка парсинга inbound.settings:`, e.message);
      return res.status(500).json({ error: 'Failed to parse inbound settings' });
    }

    const clients = settings.clients || [];
    const client = clients.find(c => c.email === email);

    if (!client) {
      console.warn(`❌ Клиент ${email} не найден в inbound ID=${inbound.id}`);
      return res.status(404).json({ error: `Client ${email} not found` });
    }

    console.log(`✅ Найден клиент ${email}, UUID=${client.id}`);

    // Удаляем через API панели
    const deleteResp = await fetchWithAuth({
      method: 'POST',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/${serverConfig.INBOUND_ID}/delClient/${client.id}`,
      headers: {
        'Accept': 'application/json'
      }
    }, serverConfig);

    if (deleteResp.data.success) {
      console.log(`✅ Клиент ${email} удалён`);
      return res.json({ success: true, message: `Client ${email} deleted` });
    } else {
      console.error(`❌ Ошибка удаления клиента:`, deleteResp.data.msg);
      return res.status(500).json({ error: deleteResp.data.msg || 'Unknown error' });
    }

  } catch (err) {
    console.error(`❌ Ошибка при удалении клиента:`, err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});


/** ➕ Добавление клиента */
app.post('/add/:email', async (req, res) => {
  const email = req.params.email;
  console.log(`➕ Запрос на добавление клиента: ${email}`);

  // Определяем сервер
  const serverConfig = getServerConfigBySuffix(email);

  // Генерируем UUID для нового клиента
  const uuid = uuidv4();

  // Готовим объект клиента
  const client = {
    id: uuid,
    flow: "xtls-rprx-vision",
    email: email,
    limitIp: 0,
    totalGB: 0,
    expiryTime: 0,
    enable: true,
    tgId: "",
    reset: 0
  };

  // Тело запроса
  const body = {
    id: serverConfig.INBOUND_ID,
    settings: JSON.stringify({ clients: [client] })
  };

  try {
    const addResp = await fetchWithAuth({
      method: 'POST',
      url: `${serverConfig.PANEL_URL}/panel/api/inbounds/addClient`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: body
    }, serverConfig);

    if (addResp.data.success) {
      console.log(`✅ Клиент ${email} добавлен (UUID=${uuid})`);
      return res.json({
        success: true,
        uuid,
        email,
        message: `Client ${email} added`
      });
    } else {
      console.error(`❌ Ошибка добавления клиента:`, addResp.data.msg);
      return res.status(500).json({ error: addResp.data.msg || 'Unknown error' });
    }
  } catch (err) {
    console.error(`❌ Ошибка при добавлении клиента:`, err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

//Запуск сервера
app.listen(PORT, async () => {
    console.log(`🚀 Прокси-API запущен на http://localhost:${PORT}`);
    try {
        await loginToPanel(SERVER_CONFIGS.NL);
        await loginToPanel(SERVER_CONFIGS.DE);
    } catch (e) {
        console.error('⚠️ Не удалось авторизоваться при запуске:', e.message);
    }
});
