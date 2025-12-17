const API_URL = process.env.API_URL || 'http://localhost:8080/api/increment';

async function makeRequest(targetDate = null) {
  try {
    const url = targetDate ? `${API_URL}?date=${targetDate}` : API_URL;
    const response = await fetch(url, {
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

const dayPatterns = {
  0: { name: 'Sunday', multiplier: 1.2, peakHours: [14, 15, 16] },
  1: { name: 'Monday', multiplier: 1.5, peakHours: [9, 10, 11, 14, 15] },
  2: { name: 'Tuesday', multiplier: 1.6, peakHours: [9, 10, 11, 14, 15] },
  3: { name: 'Wednesday', multiplier: 1.4, peakHours: [9, 10, 11, 14, 15] },
  4: { name: 'Thursday', multiplier: 1.5, peakHours: [9, 10, 11, 14, 15] },
  5: { name: 'Friday', multiplier: 1.8, peakHours: [10, 11, 12, 13, 14, 15] },
  6: { name: 'Saturday', multiplier: 0.8, peakHours: [12, 13, 14, 15, 16] },
};


const hourlyDistribution = [
  0.1, 0.05, 0.03, 0.02, 0.02, 0.03, 0.1, 0.3,
  0.7, 0.9, 1.0, 0.9, 0.8, 0.9, 1.0, 0.9,
  0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1
];

function getDayName(dayIndex) {
  return dayPatterns[dayIndex]?.name || 'Unknown';
}

function getDayMultiplier(dayIndex) {
  return dayPatterns[dayIndex]?.multiplier || 1.0;
}

function getPeakHours(dayIndex) {
  return dayPatterns[dayIndex]?.peakHours || [];
}

async function simulateDayTraffic(dayIndex, baseRate, dayName, targetDate, timeAllocation, totalTime) {
  const dayMultiplier = getDayMultiplier(dayIndex);
  const peakHours = getPeakHours(dayIndex);
  const totalRequests = Math.floor(baseRate * dayMultiplier * 24);
  
  console.log(`\nSimulating ${dayName} (Day ${dayIndex}) - Date: ${targetDate}`);
  console.log(`   Multiplier: ${dayMultiplier}x | Time: ${(timeAllocation / 1000).toFixed(1)}s | Requests: ${totalRequests}`);
  console.log(`   Peak hours: ${peakHours.join(', ')}`);
  
  let successCount = 0;
  let errorCount = 0;
  const dayStartTime = Date.now();
  
  const intervals = 24;
  const intervalTime = timeAllocation / intervals;
  
  for (let hour = 0; hour < intervals; hour++) {
    const hourMultiplier = hourlyDistribution[hour];
    const isPeakHour = peakHours.includes(hour);
    const peakBoost = isPeakHour ? 1.5 : 1.0;
    
    const hourRequests = Math.floor(
      (totalRequests / intervals) * hourMultiplier * peakBoost
    );
    
    if (hourRequests > 0) {
      const hourLabel = hour.toString().padStart(2, '0') + ':00';
      const isHighTraffic = hourRequests > (totalRequests / intervals * 0.8);
      const trafficIndicator = isHighTraffic ? '📈 HIGH' : (hourRequests < (totalRequests / intervals * 0.3) ? '📉 LOW' : '➡️  MED');
      
      process.stdout.write(`   ${hourLabel} ${trafficIndicator} (${hourRequests} req) `);
      
      const baseDelay = intervalTime / hourRequests;
      const delayVariation = baseDelay * 0.3;
      
      for (let i = 0; i < hourRequests; i++) {
        const result = await makeRequest(targetDate);
        if (result && result.success) {
          successCount++;
          if (isHighTraffic && i % Math.max(1, Math.floor(hourRequests / 10)) === 0) {
            process.stdout.write('.');
          }
        } else {
          errorCount++;
        }
        
        if (i < hourRequests - 1) {
          const randomVariation = (Math.random() * 2 - 1) * delayVariation;
          const actualDelay = Math.max(1, baseDelay + randomVariation);
          await new Promise(resolve => setTimeout(resolve, actualDelay));
        }
      }
      
      console.log(` done`);
    } else {
      process.stdout.write(`   ${hour.toString().padStart(2, '0')}:00 📉 LOW (0 req) - sleeping...\r`);
      await new Promise(resolve => setTimeout(resolve, intervalTime));
      console.log(`   ${hour.toString().padStart(2, '0')}:00 📉 LOW (0 req) ✅`);
    }
  }
  
  console.log(`${dayName} complete: ${successCount} successful, ${errorCount} failed`);
  return { successCount, errorCount };
}

async function simulateWeekTraffic(baseRate = 100, daysToSimulate = 7) {
  const TOTAL_TIME_MS = 10000;
  const TIME_PER_DAY = TOTAL_TIME_MS / daysToSimulate;
  
  console.log('🚀 Starting 7-Day Traffic Simulation (FAST MODE - 10 seconds)');
  console.log(`   Base rate: ${baseRate} requests/hour`);
  console.log(`   Days to simulate: ${daysToSimulate}`);
  console.log(`   Total time: ${(TOTAL_TIME_MS / 1000).toFixed(1)}s (${(TIME_PER_DAY / 1000).toFixed(2)}s per day)`);
  console.log(`   API endpoint: ${API_URL}\n`);
  
  const startTime = Date.now();
  let totalSuccess = 0;
  let totalErrors = 0;
  
  const today = new Date();
  const currentDayIndex = today.getDay();
  
  const daysToRun = [];
  const datesToRun = [];
  
  for (let i = daysToSimulate - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateString = date.toISOString().split('T')[0];
    const dayIndex = date.getDay();
    
    daysToRun.push(dayIndex);
    datesToRun.push(dateString);
  }
  
  console.log('📆 Simulation Schedule:');
  daysToRun.forEach((dayIndex, idx) => {
    const dayName = getDayName(dayIndex);
    const dateStr = datesToRun[idx];
    const isToday = idx === daysToRun.length - 1;
    console.log(`   ${idx + 1}. ${dayName} (${dateStr})${isToday ? ' - TODAY' : ''}`);
  });
  console.log('');
  

  for (let i = 0; i < daysToRun.length; i++) {
    const dayIndex = daysToRun[i];
    const dayName = getDayName(dayIndex);
    const targetDate = datesToRun[i];
    const isToday = i === daysToRun.length - 1;
    
    const result = await simulateDayTraffic(dayIndex, baseRate, dayName, targetDate, TIME_PER_DAY, TOTAL_TIME_MS);
    totalSuccess += result.successCount;
    totalErrors += result.errorCount;
    
    if (i < daysToRun.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  const actualRate = totalSuccess / duration;
  const targetDuration = TOTAL_TIME_MS / 1000;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ 7-Day Simulation Complete!');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total requests sent: ${totalSuccess + totalErrors}`);
  console.log(`Successful: ${totalSuccess}`);
  console.log(`Failed: ${totalErrors}`);
  console.log(`Target duration: ${targetDuration.toFixed(1)}s | Actual: ${duration.toFixed(2)}s`);
  console.log(`Average rate: ${actualRate.toFixed(2)} requests/second`);
  console.log(`\n📊 Check your dashboard to see the weekly traffic chart with highs and lows!`);
  console.log(`   The chart should show realistic traffic patterns:`);
  console.log(`   📈 High traffic on weekdays (Mon-Fri)`);
  console.log(`   📉 Lower traffic on weekends (Sat-Sun)`);
  console.log(`   🌊 Natural variations with peaks and dips`);
}

const baseRate = parseInt(process.argv[2]) || 50;
const daysToSimulate = parseInt(process.argv[3]) || 7; 


simulateWeekTraffic(baseRate, daysToSimulate).catch(console.error);

