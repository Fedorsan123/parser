// test.js

// —————————————————————————————————————————
// Полифилл для crypto.getRandomValues (нужен node-cron)
const { webcrypto } = require('crypto');
global.crypto = webcrypto;
// —————————————————————————————————————————

const puppeteer = require('puppeteer');
const cron      = require('node-cron');
const axios     = require('axios');
const fs        = require('fs').promises;
const path      = require('path');

// ========== НАСТРОЙКИ ==========
const BOT_TOKEN    = "7686937353:AAGFv54jB_Qjd6nzDpd-lVGeQo1LhkwneIo";
const CHAT_ID      = "1225216813";
const URL          = "https://academyffc.com/raspisanie/";
const JSON_DB_PATH = path.join(__dirname, "data.json");
// ================================

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function initBrowser() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-gpu'
    ],
    defaultViewport: { width: 800, height: 600 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('GymParser/1.0');
  return { browser, page };
}

async function fetchAndSend() {
  const nowUtc   = new Date();
  const khabHour = (nowUtc.getUTCHours() + 10) % 24;
  const khabMin  = nowUtc.getUTCMinutes();
  const timeStr  = `${String(khabHour).padStart(2,'0')}:${String(khabMin).padStart(2,'0')}`;

  let browser, page;
  try {
    console.log(`\n[${timeStr}] Инициализация браузера…`);
    ({ browser, page } = await initBrowser());

    console.log(`[${timeStr}] Навигация к ${URL}`);
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

    const frameSelector  = '#personal_widget_frame_v7u';
    const maxAttempts    = 6;
    const reloadInterval = 2;
    const waitPerAttempt = 10000;

    console.log(`[${timeStr}] Ждём iframe ${frameSelector}`);
    await page.waitForSelector(frameSelector, { timeout: 60000 });
    let frameHandle = await page.$(frameSelector);
    let frame       = await frameHandle.contentFrame();
    let count       = null;

    for (let i = 1; i <= maxAttempts; i++) {
      console.log(`[${timeStr}] Попытка ${i}/${maxAttempts}: ждём ${waitPerAttempt/1000}s`);
      await sleep(waitPerAttempt);

      count = await frame.evaluate(() => {
        const el = document.querySelector('current-load');
        return el?.getAttribute('data-count')?.trim() || null;
      });

      if (count) {
        console.log(`[${timeStr}] Получили count = ${count}`);
        break;
      }
      console.log(`[${timeStr}] data-count ещё не появился`);

      if (i % reloadInterval === 0 && i < maxAttempts) {
        console.log(`[${timeStr}] Перезагружаем страницу (после ${i} попыток)`);
        await page.reload({ waitUntil: 'networkidle2', timeout: 120000 });
        await page.waitForSelector(frameSelector, { timeout: 60000 });
        frameHandle = await page.$(frameSelector);
        frame       = await frameHandle.contentFrame();
      }
    }

    if (!count) {
      throw new Error('Не удалось получить data-count после нескольких попыток');
    }

    const msg = `Время : ${timeStr}; Люди: ${count}`;
    if (khabHour >= 7 && khabHour < 23) {
      await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        { chat_id: CHAT_ID, text: msg }
      );
      console.log(`[${timeStr}] Отправлено: ${msg}`);
    } else {
      console.log(`[${timeStr}] Вне окна (07–23) — пропущено`);
    }

    const rec = { time: timeStr, count: +count };
    let data = [];
    try {
      data = JSON.parse(await fs.readFile(JSON_DB_PATH, 'utf8'));
      if (!Array.isArray(data)) data = [];
    } catch {}
    data.push(rec);
    await fs.writeFile(JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf8');

  } catch (err) {
    console.error(`[${timeStr}] Ошибка: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

(async () => {
  // Первый замер сразу при старте
  await fetchAndSend();
  // Расписание: каждые 10 минут
  cron.schedule('*/5 * * * *', fetchAndSend);
})();
