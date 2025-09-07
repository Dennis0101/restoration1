import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

export const restoreRouter = Router();
const prisma = new PrismaClient();

// ✅ 완전 경로
restoreRouter.post('/restore/:key', async (req, res) => {
  const key = req.params.key;
  if (!key) return res.status(400).json({ error: 'key required' });

  // 키 검증/잡 생성 예시
  const cohort = await prisma.recoveryCohort.findFirst({ where: { key } });
  if (!cohort) return res.status(404).json({ error: 'cohort not found' });

  // 여기서 BullMQ 잡 생성/큐에 push
  const jobId = Math.random().toString(36).slice(2, 10);
  // await queue.add('restore', { jobId, cohortId: cohort.id });

  return res.json({ jobId });
});
