import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());


const dailyTraffic = new Map();
let incrementLock = false;


const hourlyTraffic = new Map();
const minuteTraffic = new Map();

function getTodayString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

function getDayName(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

function getLast7Days() {
  const today = getTodayString();
  const todayDate = new Date();
  const days = [];
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(todayDate);
    date.setDate(date.getDate() - i);
    const dateString = date.toISOString().split('T')[0];
    const dayName = getDayName(dateString);
    
    const traffic = dailyTraffic.get(dateString) || 0;
    const isCurrentDay = dateString === today;
    
    days.push({
      date: dateString,
      day: dayName,
      traffic: traffic,
      isCurrentDay: isCurrentDay
    });
  }
  
  return days;
}

function getCurrentHourString() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hour = now.getHours().toString().padStart(2, '0');
  return `${dateStr}-${hour}`;
}

function getCurrentMinuteIntervalString() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = Math.floor(now.getMinutes() / 10) * 10;
  const minuteStr = minute.toString().padStart(2, '0');
  return `${dateStr}-${hour}-${minuteStr}`;
}

function getCurrentDayHourlyTraffic() {
  const today = getTodayString();
  const intervals = [];
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = Math.floor(now.getMinutes() / 10) * 10;
  
  const hoursToShow = 6;
  const startHour = Math.max(0, currentHour - (hoursToShow - 1));
  
  for (let h = startHour; h <= currentHour; h++) {
    const maxMinute = (h === currentHour) ? currentMinute : 50;
    
    for (let m = 0; m <= maxMinute; m += 10) {
      const intervalKey = `${today}-${h.toString().padStart(2, '0')}-${m.toString().padStart(2, '0')}`;
      const traffic = minuteTraffic.get(intervalKey) || 0;
      
      let label = '';
      if (h === currentHour && m === currentMinute) {
        label = 'Now';
      } else {
        label = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
      
      intervals.push({
        hour: h,
        minute: m,
        label: label,
        traffic: traffic,
        timestamp: intervalKey
      });
    }
  }
  
  if (intervals.length > 36) {
    const step = Math.ceil(intervals.length / 36);
    return intervals.filter((_, index) => index % step === 0 || index === intervals.length - 1);
  }
  
  return intervals;
}


async function incrementTraffic() {
  while (incrementLock) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  
  incrementLock = true;
  try {
    const today = getTodayString();
    const currentCount = dailyTraffic.get(today) || 0;
    const newCount = currentCount + 1;
    
    dailyTraffic.set(today, newCount);
    
    const currentHourKey = getCurrentHourString();
    const currentHourCount = hourlyTraffic.get(currentHourKey) || 0;
    hourlyTraffic.set(currentHourKey, currentHourCount + 1);
    
    const currentMinuteKey = getCurrentMinuteIntervalString();
    const currentMinuteCount = minuteTraffic.get(currentMinuteKey) || 0;
    minuteTraffic.set(currentMinuteKey, currentMinuteCount + 1);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffString = cutoffDate.toISOString().split('T')[0];
    
    for (const [dateString] of dailyTraffic.entries()) {
      if (dateString < cutoffString) {
        dailyTraffic.delete(dateString);
      }
    }
    
    for (const [hourKey] of hourlyTraffic.entries()) {
      if (!hourKey.startsWith(today)) {
        hourlyTraffic.delete(hourKey);
      }
    }
    
    const sixHoursAgo = new Date();
    sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
    const cutoffMinuteString = sixHoursAgo.toISOString().split('T')[0];
    const cutoffHour = sixHoursAgo.getHours();
    
    for (const [minuteKey] of minuteTraffic.entries()) {
      const parts = minuteKey.split('-');
      if (parts.length >= 3) {
        const keyDate = parts[0];
        const keyHour = parseInt(parts[1]);
        if (keyDate < cutoffMinuteString || (keyDate === cutoffMinuteString && keyHour < cutoffHour)) {
          minuteTraffic.delete(minuteKey);
        }
      }
    }
    
    return newCount;
  } finally {
    incrementLock = false;
  }
}

function getCurrentTraffic() {
  const today = getTodayString();
  return dailyTraffic.get(today) || 0;
}

function getTotalTraffic() {
  const last7Days = getLast7Days();
  return last7Days.reduce((sum, day) => sum + day.traffic, 0);
}

function getPercentageChange() {
  const last7Days = getLast7Days();
  if (last7Days.length < 2) return 0;
  
  const previous7Days = last7Days.slice(0, 6);
  const previousTotal = previous7Days.reduce((sum, day) => sum + day.traffic, 0);
  const currentTotal = getTotalTraffic();
  
  if (previousTotal === 0) return currentTotal > 0 ? 100 : 0;
  
  return ((currentTotal - previousTotal) / previousTotal) * 100;
}

function resetTraffic() {
  dailyTraffic.clear();
}

console.log('✅ Using in-memory daily traffic tracking (Redis not required)');

const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  sendTrafficData(ws);

  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.ping();
      } catch (error) {
        console.error('Error sending ping:', error);
        clearInterval(pingInterval);
        clients.delete(ws);
      }
    } else {
      clearInterval(pingInterval);
      clients.delete(ws);
    }
  }, 30000);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clearInterval(pingInterval);
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(pingInterval);
    clients.delete(ws);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'getTraffic') {
        sendTrafficData(ws);
      } else if (data.type === 'pong') {
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });
});

function sendTrafficData(ws) {
  try {
    const last7Days = getLast7Days();
    const totalTraffic = getTotalTraffic();
    const percentageChange = getPercentageChange();
    const currentTraffic = getCurrentTraffic();
    const hourlyData = getCurrentDayHourlyTraffic();
    
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'traffic',
        data: last7Days,
        hourlyData: hourlyData,
        total: totalTraffic,
        currentDay: currentTraffic,
        percentageChange: percentageChange,
        timestamp: Date.now()
      }));
    }
  } catch (error) {
    console.error('Error sending traffic data:', error);
  }
}

function broadcastTrafficData() {
  try {
    const last7Days = getLast7Days();
    const totalTraffic = getTotalTraffic();
    const percentageChange = getPercentageChange();
    const currentTraffic = getCurrentTraffic();
    const hourlyData = getCurrentDayHourlyTraffic();
    
    const message = JSON.stringify({
      type: 'traffic',
      data: last7Days,
      hourlyData: hourlyData,
      total: totalTraffic,
      currentDay: currentTraffic,
      percentageChange: percentageChange,
      timestamp: Date.now()
    });

    clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      } else {
        clients.delete(client);
      }
    });
  } catch (error) {
    console.error('Error broadcasting traffic data:', error);
  }
}

app.post('/api/increment', async (req, res) => {
  try {
    const targetDate = req.query.date || req.body.date;
    let newCount;
    
    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      const currentCount = dailyTraffic.get(targetDate) || 0;
      newCount = currentCount + 1;
      dailyTraffic.set(targetDate, newCount);
      
      const now = new Date();
      const hour = now.getHours().toString().padStart(2, '0');
      const hourKey = `${targetDate}-${hour}`;
      const currentHourCount = hourlyTraffic.get(hourKey) || 0;
      hourlyTraffic.set(hourKey, currentHourCount + 1);
      
      const minute = Math.floor(now.getMinutes() / 10) * 10;
      const minuteKey = `${targetDate}-${hour}-${minute.toString().padStart(2, '0')}`;
      const currentMinuteCount = minuteTraffic.get(minuteKey) || 0;
      minuteTraffic.set(minuteKey, currentMinuteCount + 1);
    } else {
      newCount = await incrementTraffic();
      broadcastTrafficData();
    }

    res.json({
      success: true,
      count: newCount,
      date: targetDate || getTodayString(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error incrementing traffic:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/traffic', (req, res) => {
  try {
    const last7Days = getLast7Days();
    const totalTraffic = getTotalTraffic();
    const percentageChange = getPercentageChange();
    const currentTraffic = getCurrentTraffic();
    const hourlyData = getCurrentDayHourlyTraffic();
    
    res.json({
      success: true,
      data: last7Days,
      hourlyData: hourlyData,
      total: totalTraffic,
      currentDay: currentTraffic,
      percentageChange: percentageChange,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error getting traffic data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: []
    });
  }
});

app.post('/api/reset', (req, res) => {
  try {
    resetTraffic();
    broadcastTrafficData();
    res.json({
      success: true,
      message: 'Traffic data reset successfully'
    });
  } catch (error) {
    console.error('Error resetting traffic:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    storage: 'in-memory',
    currentTraffic: getCurrentTraffic(),
    totalTraffic: getTotalTraffic(),
    websocketClients: clients.size,
    timestamp: Date.now()
  });
});

const HEARTBEAT_INTERVAL = 1000;
const heartbeatInterval = setInterval(() => {
  if (clients.size > 0) {
    broadcastTrafficData();
  }
}, HEARTBEAT_INTERVAL);

console.log(`heartbeat enabled (updates every ${HEARTBEAT_INTERVAL}ms)`);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/increment`);
  console.log(`Real-time updates: Broadcasting every ${HEARTBEAT_INTERVAL}ms`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  console.log(`Final traffic: ${getTotalTraffic()} (current day: ${getCurrentTraffic()})`);
  
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

