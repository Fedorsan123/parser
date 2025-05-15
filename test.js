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

const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser, page;

async function initBrowser() {
  browser = await puppeteer.launch({
    headless: true,    // показываем окно для наглядности
    slowMo: 50,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });
  page = await browser.newPage();
  await page.setUserAgent('GymParser/1.0');
}

async function fetchAndSend() {
  // UTC → Хабаровск (UTC+10)
  const nowUtc   = new Date();
  const khabHour = (nowUtc.getUTCHours() + 10) % 24;
  const khabMin  = nowUtc.getUTCMinutes();
  const timeStr  = `${String(khabHour).padStart(2,'0')}:${String(khabMin).padStart(2,'0')}`;

  try {
    console.log(`\n[${timeStr}] Навигация к ${URL}`);
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

    const frameSelector   = '#personal_widget_frame_v7u';
    const maxAttempts     = 6;
    const reloadInterval  = 2;
    const waitPerAttempt  = 10000;  

    // дождаться появления iframe
    console.log(`[${timeStr}] Ждём iframe ${frameSelector}`);
    await page.waitForSelector(frameSelector, { timeout: 60000 });

    let frameHandle = await page.$(frameSelector);
    let frame       = await frameHandle.contentFrame();
    let count       = null;

    // цикл попыток
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

      // каждые reloadInterval попыток — перезагружаем страницу
      if (i % reloadInterval === 0 && i < maxAttempts) {
        console.log(`[${timeStr}] Перезагружаем страницу (после ${i} попыток)`);
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector(frameSelector, { timeout: 60000 });
        frameHandle = await page.$(frameSelector);
        frame       = await frameHandle.contentFrame();
      }
    }

    if (!count) {
      throw new Error('Не удалось получить data-count после нескольких попыток');
    }

    const msg = `Время : ${timeStr}; Люди: ${count}`;

    // отправка только между 07–23 по Хабаровску
    if (khabHour >= 7 && khabHour < 23) {
      await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        { chat_id: CHAT_ID, text: msg }
      );
      console.log(`[${timeStr}] Отправлено: ${msg}`);
    } else {
      console.log(`[${timeStr}] Вне окна (07–23) — пропущено`);
    }

    // логируем всегда
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
  }
}

(async () => {
  await initBrowser();
  await fetchAndSend();
  // расписание — каждые 10 минут
  cron.schedule('*/5 * * * * ', fetchAndSend);
})();
