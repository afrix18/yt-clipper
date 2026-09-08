import { Router, Request, Response } from 'express';
import type { UploadItem } from '../lib/types';

export const uploadRouter = Router();

// In-memory upload queue store for cross-origin batch sync with YouTube Studio
let uploadQueue: UploadItem[] = [];
let uploadQueueIndex = 0;

// ── GET / POST / DELETE /api/pending-upload ─────────────────────────
uploadRouter.get('/api/pending-upload', (req: Request, res: Response) => {
  const current = uploadQueue[uploadQueueIndex] || null;
  res.json({
    pending: current,
    queueTotal: uploadQueue.length,
    queueIndex: uploadQueueIndex,
    remaining: Math.max(0, uploadQueue.length - uploadQueueIndex - 1),
    allItems: uploadQueue,
  });
});

uploadRouter.post('/api/pending-upload', (req: Request, res: Response) => {
  if (Array.isArray(req.body.items) && req.body.items.length > 0) {
    uploadQueue = req.body.items.map((item: UploadItem, idx: number) => ({
      ...item,
      queueIndex: idx,
      queueTotal: req.body.items.length,
      timestamp: Date.now(),
    }));
    uploadQueueIndex = 0;
    console.log(`[Upload Queue] Initialized batch queue with ${uploadQueue.length} items.`);
  } else {
    uploadQueue = [{
      ...req.body,
      queueIndex: 0,
      queueTotal: 1,
      timestamp: Date.now(),
    }];
    uploadQueueIndex = 0;
    console.log('[Upload Queue] Initialized single item upload:', uploadQueue[0].title);
  }
  res.json({
    success: true,
    pending: uploadQueue[0],
    queueTotal: uploadQueue.length,
    queueIndex: 0,
  });
});

uploadRouter.post('/api/pending-upload/advance', (req: Request, res: Response) => {
  if (uploadQueueIndex < uploadQueue.length - 1) {
    uploadQueueIndex++;
    const nextItem = uploadQueue[uploadQueueIndex];
    console.log(`[Upload Queue] Advanced to item ${uploadQueueIndex + 1}/${uploadQueue.length}: ${nextItem.title}`);
    res.json({
      success: true,
      hasMore: true,
      next: nextItem,
      queueIndex: uploadQueueIndex,
      queueTotal: uploadQueue.length,
      remaining: uploadQueue.length - uploadQueueIndex - 1,
    });
  } else {
    console.log('[Upload Queue] Queue completed! All items uploaded/scheduled.');
    uploadQueue = [];
    uploadQueueIndex = 0;
    res.json({
      success: true,
      hasMore: false,
      next: null,
      queueIndex: 0,
      queueTotal: 0,
      remaining: 0,
    });
  }
});

uploadRouter.delete('/api/pending-upload', (req: Request, res: Response) => {
  uploadQueue = [];
  uploadQueueIndex = 0;
  res.json({ success: true });
});
