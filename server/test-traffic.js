const API_URL = process.env.API_URL || 'http://localhost:8080/api/increment';

async function makeRequest() {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Request failed:', error.message);
    return null;
  }
}

async function sendBurstTraffic(burstSize, baseDelay) {
  const burstDelay = Math.max(1, baseDelay / 10); 
  for (let i = 0; i < burstSize; i++) {
    await makeRequest();
    if (i < burstSize - 1) {
      await new Promise(resolve => setTimeout(resolve, burstDelay));
    }
  }
}

async function simulateTraffic(totalRequests, delayMs, intervalRequests, intervalSeconds) {
  const useIntervalRequests = intervalRequests > 0;
  const useIntervalTime = intervalSeconds > 0;
  
  console.log(`Starting traffic simulation with variable patterns:`);
  console.log(`- Total requests: ${totalRequests}`);
  console.log(`- Base delay between requests: ${delayMs}ms (±10% random variation)`);
  console.log(`- Base rate: ~${(1000 / delayMs).toFixed(2)} requests/second`);
  if (useIntervalRequests) {
    console.log(`- Extra 10% traffic burst every ${intervalRequests} requests`);
  }
  if (useIntervalTime) {
    console.log(`- Extra 10% traffic burst every ${intervalSeconds} seconds`);
  }
  console.log(`- Expected duration: ~${((totalRequests * delayMs) / 1000).toFixed(1)} seconds\n`);

  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();
  let lastBurstTime = startTime;
  let requestCount = 0;

  for (let i = 1; i <= totalRequests; i++) {
    const result = await makeRequest();
    requestCount++;
    
    if (result && result.success) {
      successCount++;
      if (i % 100 === 0) {
        console.log(`Progress: ${i}/${totalRequests} (Count: ${result.count})`);
      }
    } else {
      errorCount++;
    }

    const currentTime = Date.now();
    const timeSinceLastBurst = (currentTime - lastBurstTime) / 1000;
    
    let shouldBurst = false;
    
    if (useIntervalRequests && i % intervalRequests === 0) {
      shouldBurst = true;
      console.log(`\n[Interval] Adding 10% extra traffic burst at request ${i}...`);
    }
    
    if (useIntervalTime && timeSinceLastBurst >= intervalSeconds) {
      shouldBurst = true;
      console.log(`\n[Time Interval] Adding 10% extra traffic burst after ${timeSinceLastBurst.toFixed(1)}s...`);
      lastBurstTime = currentTime;
    }
    
    if (shouldBurst) {
      const burstSize = Math.max(1, Math.floor(intervalRequests * 0.1));
      await sendBurstTraffic(burstSize, delayMs);
      successCount += burstSize;
      requestCount += burstSize;
      console.log(`Burst complete: Added ${burstSize} extra requests\n`);
    }

    if (i < totalRequests) {
      const delayVariation = delayMs * 0.1; 
      const randomVariation = (Math.random() * 2 - 1) * delayVariation; 
      const actualDelay = Math.max(1, delayMs + randomVariation);
      await new Promise(resolve => setTimeout(resolve, actualDelay));
    }
  }

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  const actualRate = requestCount / duration;

  console.log(`\n=== Simulation Complete ===`);
  console.log(`Total requests sent: ${requestCount}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`Actual rate: ${actualRate.toFixed(2)} requests/second`);
}

const totalRequests = parseInt(process.argv[2]) || 400;
const delayMs = parseInt(process.argv[3]) || 60; 
const intervalRequests = parseInt(process.argv[4]) || 50; 
const intervalSeconds = parseInt(process.argv[5]) || 2.5; 


simulateTraffic(totalRequests, delayMs, intervalRequests, intervalSeconds).catch(console.error);



