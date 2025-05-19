// test.js

// Полифилл для node-cron (crypto.getRandomValues)
const { webcrypto } = require('crypto');
global.crypto = webcrypto;

const puppeteer = require('puppeteer');
const cron      = require('node-cron');
const fs        = require('fs');
const path      = require('path');

// ========== НАСТРОЙКИ ==========
const URL             = "https://academyffc.com/raspisanie/";
const FRAME_ID        = "personal_widget_frame_v7u";
const CSV_PATH        = path.join(__dirname, "data.csv");
const MAX_ATTEMPTS    = 6;
const RELOAD_INTERVAL = 2;      // перезагружать страницу каждые 2 попытки
const WAIT_MS         = 10000;  // ждать 10 секунд между попытками
// ================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function initBrowser() {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 50,
    defaultViewport: null,
    args: ["--start-maximized","--no-sandbox"]
  });
  const page = await browser.newPage();
  await page.setUserAgent("GymParser/1.0");
  return { browser, page };
}

function appendToCsv(timeStr, count) {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, "Time;Count\n", "utf8");
  }
  fs.appendFileSync(CSV_PATH, `${timeStr};${count}\n`, "utf8");
  console.log(`→ CSV updated: ${CSV_PATH}`);
}

async function fetchAndSave() {
  const nowUtc   = new Date();
  const khabHour = (nowUtc.getUTCHours() + 10) % 24;
  const khabMin  = nowUtc.getUTCMinutes();
  const timeStr  = `${String(khabHour).padStart(2,"0")}:${String(khabMin).padStart(2,"0")}`;

  let browser, page;
  try {
    console.log(`\n[${timeStr}] Инициализация браузера…`);
    ({ browser, page } = await initBrowser());

    console.log(`[${timeStr}] Навигация к ${URL}`);
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 120000 });

    const sel = `#${FRAME_ID}`;
    console.log(`[${timeStr}] Ждём iframe ${sel}`);
    await page.waitForSelector(sel, { timeout: 60000 });

    let count = null;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      console.log(`[${timeStr}] Попытка ${i}/${MAX_ATTEMPTS}: ждём ${WAIT_MS/1000}s`);
      await sleep(WAIT_MS);

      const handle = await page.$(sel);
      const frame  = await handle.contentFrame();

      try {
        await frame.waitForSelector("current-load[data-count]", { timeout: 5000 });
        const txt = await frame.$eval(
          "current-load[data-count]",
          el => el.getAttribute("data-count").trim()
        );
        if (txt) {
          count = txt;
          console.log(`[${timeStr}] Получили count = ${count}`);
          break;
        }
      } catch {
        console.log(`[${timeStr}] data-count ещё не появился`);
      }

      if (i % RELOAD_INTERVAL === 0 && i < MAX_ATTEMPTS) {
        console.log(`[${timeStr}] Перезагружаем страницу`);
        await page.reload({ waitUntil: "networkidle2", timeout: 120000 });
        await page.waitForSelector(sel, { timeout: 60000 });
      }
    }

    if (!count) {
      console.log(`[${timeStr}] Не удалось получить data-count — пропускаем`);
      return;
    }

    // cron расписан только на 07–22, так что просто сохраняем
    appendToCsv(timeStr, count);

  } catch (err) {
    console.error(`[${timeStr}] Ошибка: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${timeStr}] Браузер закрыт`);
    }
  }
}

(async () => {
  // первый запуск сразу
  await fetchAndSave();

  // далее — в 0-й секунде каждой 10-й минуты, только в часы 07…22 по Хабаровску
  cron.schedule(
    "0 */10 7-22 * * *",
    fetchAndSave,
    { timezone: "Asia/Vladivostok" }
  );
})();
