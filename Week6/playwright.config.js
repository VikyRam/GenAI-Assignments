// playwright.config.js
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  timeout: 120_000,           // 2 min per test (pagination can be slow)
  retries: 1,                 // retry once on flaky network
  workers: 1,                 // single worker — sequential, avoids rate limits
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results.json" }],
  ],

  use: {
    headless: true,           // set to false to watch the browser
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    locale:    "en-AU",
    timezoneId: "Australia/Sydney",
    geolocation: { latitude: -33.8688, longitude: 151.2093 }, // Sydney
    permissions: ["geolocation"],
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
    },
    screenshot: "only-on-failure",
    video:      "retain-on-failure",
    trace:      "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
