import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

export const cohortRouter = Router();
const prisma = new PrismaClient();

// ✅ 반드시 "완전 경로" 사용
cohortRouter.post('/cohort', async (req, res) => {
  const guildId = req.body?.guildId as string | undefined;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });

  // 키 발급 로직 예시
  const cohort = await prisma.recoveryCohort.create({
    data: {
      guildId,
      key: Math.random().toString(36).slice(2, 10),
    },
    select: { id: true, key: true },
  });

  return res.json({ id: cohort.id, key: cohort.key });
});
