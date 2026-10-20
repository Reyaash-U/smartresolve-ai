import mongoose from 'mongoose';
import { config } from './config';
import { createApp } from './app';

async function main() {
  await mongoose.connect(config.mongoUri);
  createApp().listen(config.port, () => console.log(`API listening on :${config.port}`));
}

main().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
