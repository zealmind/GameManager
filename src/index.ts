import app from './server';
import { Database } from './storage/Database';

(async () => {
  const db = Database.getInstance();
  await db.init();

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4444;
  const server = app.listen(PORT, () => {
    const actualPort = (server.address() as any)?.port ?? PORT;
    console.log(`GameManager server listening on port ${actualPort}`);
  });
})();
