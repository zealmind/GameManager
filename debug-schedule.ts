import { Database } from './storage/Database';
import { SchedulingService } from './services/SchedulingService';

const db = Database.getInstance();
db.clear();

const event = db.createEvent('Test Event', 18, 3);

for (let i = 1; i <= 12; i++) {
  const player = db.createPlayer(`Player ${i}`);
  event.addPlayer(player);
}

const scheduler = new SchedulingService();
const result = scheduler.scheduleNextGame(event.id);

console.log('Scheduling result:', JSON.stringify(result, null, 2));
