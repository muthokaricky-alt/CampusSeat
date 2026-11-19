// Renders docs/diagrams/source/*.drawio to PNG with the local renderer. Usage: node diagrams.mjs <sourceDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [src, out] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const jobs = [['CampusSeat_FlowChart.drawio', 'flow-chart.png'], ['CampusSeat_ER.drawio', 'er-diagram.png'], ['CampusSeat_UseCase.drawio', 'use-case.png'], ['CampusSeat_ClassDiagram.drawio', 'class-diagram.png']];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setContent('<!doctype html><body style="margin:0;background:#fff"><div id="d"></div></body>');
await page.addScriptTag({ content: fs.readFileSync(path.join(here, 'drawio-render.js'), 'utf8') });
for (const [file, png] of jobs) {
  const xml = fs.readFileSync(path.join(src, file), 'utf8');
  const { w, h } = await page.evaluate((x) => { const r = window.renderDrawio(x); document.getElementById('d').innerHTML = r.svg; return { w: r.w, h: r.h }; }, xml);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await (await page.$('#d svg')).screenshot({ path: path.join(out, png) });
  console.log('rendered', png, w, h);
}
await browser.close();
