import express from 'express';
import cors from 'cors';
import { loadClipsMeta } from './lib/store';
import { CLIPS_DIR } from './lib/paths';
import { settingsRouter } from './routes/settings';
import { autoDetectRouter } from './routes/autoDetect';
import { clipRouter } from './routes/clip';
import { clipsRouter } from './routes/clips';
import { uploadRouter } from './routes/upload';
import { captionsRouter } from './routes/captions';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use(settingsRouter);
app.use(autoDetectRouter);
app.use(clipRouter);
app.use(clipsRouter);
app.use(uploadRouter);
app.use(captionsRouter);

app.use('/clips', express.static(CLIPS_DIR));

const PORT = Number(process.env.PORT) || 3002;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Simple clipper backend listening on http://localhost:${PORT}`);
  console.log(`Clips directory: ${CLIPS_DIR}`);
  console.log(`Stored clips: ${loadClipsMeta().length}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please terminate existing process.`);
  } else {
    console.error('Server error:', err);
  }
});
