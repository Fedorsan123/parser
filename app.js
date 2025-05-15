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

let browser, page;

async function initBrowser() {
  browser = await puppeteer.launch({
    headless: false,    // поставьте true для фонового режима
    slowMo: 50,
    defaultViewport: null
  });
  page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (compatible; GymParser/1.0)');
}

async function extractCount() {
  return page.evaluate(() => {
    const el = document.querySelector('current-load');
    if (!el) return null;
    const dc = el.getAttribute('data-count')?.trim();
    if (dc && /^\d+$/.test(dc)) return dc;
    const m = el.textContent.match(/\d+/);
    return m ? m[0] : '0';
  });
}

async function fetchAndSend() {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  try {
    console.log(`[${timeStr}] Навигация к странице…`);
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

    // Прокручиваем вниз, чтобы <current-load> оказался в зоне видимости
    console.log(`[${timeStr}] Прокрутка вниз…`);
    await page.evaluate(() => window.scrollBy(0, 300));
    await sleep(2000);

    // Ждём 20 сек, пока отработает клиентский JS
    console.log(`[${timeStr}] Ждём 20 секунд подгрузки данных…`);
    await sleep(20000);

    // Пытаемся спарсить
    let count = await extractCount();
    if (count === null) {
      console.log(`[${timeStr}] Элемент не найден, перезагружаю страницу…`);
      await page.reload({ waitUntil: 'load', timeout: 60000 });
      // снова прокрутка и ожидание
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2000);
      await sleep(20000);
      count = await extractCount();
    }

    if (count === null) {
      throw new Error('<current-load> так и не появился после retries');
    }

    // Отправляем в Telegram
    const msg = `Время: ${timeStr}; Люди: ${count}`;
    console.log(`[${timeStr}] Отправляем: ${msg}`);
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: CHAT_ID, text: msg }
    );

    // Логируем в data.json
    const rec = { time: timeStr, count: Number(count) };
    let arr = [];
    try {
      arr = JSON.parse(await fs.readFile(JSON_DB_PATH, 'utf8'));
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    arr.push(rec);
    await fs.writeFile(JSON_DB_PATH, JSON.stringify(arr, null, 2), 'utf8');

  } catch (err) {
    console.error(`[${timeStr}] Ошибка: ${err.message}`);
  }
}

(async () => {
  await initBrowser();
  await fetchAndSend();
  cron.schedule('*/10 * * * *', fetchAndSend);
})();
