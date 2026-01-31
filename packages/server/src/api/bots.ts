import type { FastifyInstance } from 'fastify';
import { testBotManager } from '../bots/TestBots.js';

export async function botsRoutes(app: FastifyInstance) {
  // Get bot status
  app.get('/api/bots/status', async () => {
    return testBotManager.getStatus();
  });

  // Start bots
  app.post('/api/bots/start', async () => {
    return testBotManager.start();
  });

  // Stop bots
  app.post('/api/bots/stop', async () => {
    return testBotManager.stop();
  });

  // Toggle bots
  app.post('/api/bots/toggle', async () => {
    if (testBotManager.isRunning()) {
      return testBotManager.stop();
    } else {
      return testBotManager.start();
    }
  });
}
