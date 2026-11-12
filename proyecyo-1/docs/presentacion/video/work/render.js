const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto("file://" + __dirname + "/video.html"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
  const fps = 30, dur = 21.0, n = Math.round(fps * dur);
  for (let f = 0; f < n; f++) { await p.evaluate((t) => window.render(t), f / fps); await p.screenshot({ path: `${__dirname}/frames/f${String(f).padStart(4, "0")}.jpg`, type: "jpeg", quality: 92 }); }
  await b.close(); console.log("frames", n);
})();
