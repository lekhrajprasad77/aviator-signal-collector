const puppeteer = require('puppeteer'); // Changed from puppeteer-core
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Initialize SQLite database
const db = new sqlite3.Database(':memory:', (err) => {
  if (err) console.error('Database error:', err);
  db.run(`CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    date TEXT,
    time TEXT,
    value REAL
  )`);
});

app.use(express.json());

// API endpoint to get signals
app.get('/api/signals', (req, res) => {
  const since = req.query.since || '1970-01-01T00:00:00Z';
  db.all('SELECT * FROM signals WHERE timestamp > ?', [since], (err, rows) => {
    if (err) {
      console.error('Database query error:', err);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// Start server
app.listen(port, () => console.log(`Server running on port ${port}`));

// Scrape Aviator signals
async function scrapeSignals() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
    // Removed executablePath
  });
  const page = await browser.newPage();
  await page.goto('https://1wmkff.life/casino/play/aviator?sub1=20250304-1943-4720-a1d0-866ebe15a895&sub2=1wins_in_reg', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  // Wait for payouts block
  await page.waitForSelector('.payouts-block, [class*="payout"], [class*="multiplier"], [class*="history"], [class*="game"], [class*="result"], [class*="coefficient"]', { timeout: 60000 });

  // Monitor for new multipliers
  await page.evaluate(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && node.matches('.payout, [class*="payout"], [class*="multiplier"], [class*="coefficient"]')) {
              const multiplierText = node.textContent.trim();
              const multiplier = parseFloat(multiplierText.replace(/,/g, '').replace('x', ''));
              if (!isNaN(multiplier)) {
                const now = new Date();
                const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                const istTime = new Date(utc + (330 * 60000));
                const timestamp = now.toISOString();
                const date = `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')}`;
                const time = `${String(istTime.getHours()).padStart(2, '0')}:${String(istTime.getMinutes()).padStart(2, '0')}:${String(istTime.getSeconds()).padStart(2, '0')}`;
                fetch('/api/save-signal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ timestamp, date, time, value: multiplier })
                });
              }
            }
          });
        }
      });
    });
    const payoutsBlock = document.querySelector('.payouts-block, [class*="payout"], [class*="multiplier"], [class*="history"], [class*="game"], [class*="result"], [class*="coefficient"]');
    if (payoutsBlock) {
      observer.observe(payoutsBlock, { childList: true, subtree: true });
    }
  });

  // Save signal internally
  app.post('/api/save-signal', (req, res) => {
    const { timestamp, date, time, value } = req.body;
    db.run('INSERT INTO signals (timestamp, date, time, value) VALUES (?, ?, ?, ?)', [timestamp, date, time, value], (err) => {
      if (err) {
        console.error('Database insert error:', err);
        res.status(500).json({ error: 'Database error' });
      } else {
        console.log(`Saved signal: ${value} at ${date} ${time}`);
        res.json({ status: 'ok' });
      }
    });
  });

  // Handle 502 errors with retries
  page.on('error', async () => {
    console.log('Page error, retrying in 10s...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  });
}

// Start scraping
scrapeSignals().catch(err => {
  console.error('Scrape error:', err);
  setTimeout(scrapeSignals, 10000); // Retry after 10s
});
