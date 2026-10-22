import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("https://talkfirst.ccwu.cc/login", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);
console.log("buttons:", await page.locator("button").evaluateAll(els => els.map(e => `${e.textContent?.trim()}|${e.getAttribute("type")}`)));
console.log("links:", await page.locator("a").evaluateAll(els => els.map(e => `${e.textContent?.trim()}|${e.getAttribute("href")}`)));
console.log("inputs:", await page.locator("input").evaluateAll(els => els.map(e => `${e.id}|${e.getAttribute("type")}|${e.getAttribute("placeholder")}`)));
await browser.close();
