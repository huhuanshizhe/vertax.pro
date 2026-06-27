// Test the web-crawl cron endpoint directly
async function test() {
  const CRON_SECRET = process.env.CRON_SECRET || "dev-secret";
  const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

  console.log("=== Test 1: Check if cron endpoint is reachable ===");
  try {
    const res = await fetch(`${BASE_URL}/api/cron/web-crawl`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${CRON_SECRET}`,
      },
    });
    console.log("Status:", res.status);
    const body = await res.text();
    console.log("Body:", body.slice(0, 500));
  } catch (e) {
    console.error("Error:", e.message);
  }

  console.log("\n=== Test 2: Simulate web-import POST ===");
  try {
    const res = await fetch(`${BASE_URL}/api/assets/web-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer test-token`,
      },
      body: JSON.stringify({
        url: "https://www.farmetra.com",
        maxPages: 50,
      }),
    });
    console.log("Status:", res.status);
    const body = await res.text();
    console.log("Body:", body.slice(0, 1000));
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test().catch(e => console.error(e));
