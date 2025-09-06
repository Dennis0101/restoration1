import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();
export const restoreRouter = Router();
const restoreQueue = new Queue('restore', { connection: { url: process.env.REDIS_URL! } });

restoreRouter.post('/restore/:key', async (req: Request, res: Response) => {
  const key = req.params.key;
  const cohort = await prisma.recoveryCohort.findUnique({ where: { key } });
  if (!cohort) return res.status(404).json({ error: 'invalid key' });
  const job = await prisma.restoreJob.create({ data: { cohortId: cohort.id, guildId: cohort.guildId } });
  await restoreQueue.add('restore', { jobId: job.id }, { removeOnComplete: true, attempts: 2, backoff: { type: 'exponential', delay: 2000 } });
  res.json({ jobId: job.id });
});

restoreRouter.get('/status/:jobId', async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = await prisma.restoreJob.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ status: job.status, progress: job.progress, error: job.error });
});
