import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { oauthRefresh, guildsJoin, patchRoles } from './discord';

const prisma = new PrismaClient();
const connection = { url: process.env.REDIS_URL! };

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

new Worker('restore', async job => {
  const jobId = job.data.jobId as string;

  const row = await prisma.restoreJob.update({ where: { id: jobId }, data: { status: 'running', progress: 0 } });
  const cohort = await prisma.recoveryCohort.findUnique({ where: { id: row.cohortId } });
  if (!cohort) throw new Error('cohort not found');

  const members = await prisma.recoveryMember.findMany({ where: { cohortId: cohort.id } });
  let done = 0;

  for (const m of members) {
    try {
      // base64 ↔️ plain (운영에선 AES-GCM 사용 권장)
      let access = Buffer.from(m.accessTokenEnc, 'base64').toString('utf8');

      if (m.tokenExpiresAt.getTime() - Date.now() < 60_000) {
        const t = await oauthRefresh(Buffer.from(m.refreshTokenEnc, 'base64').toString('utf8'));
        access = t.access_token;
        await prisma.recoveryMember.update({
          where: { id: m.id },
          data: {
            accessTokenEnc: Buffer.from(t.access_token, 'utf8').toString('base64'),
            refreshTokenEnc: Buffer.from(t.refresh_token, 'utf8').toString('base64'),
            tokenScope: t.scope,
            tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000)
          }
        });
      }

      const res = await guildsJoin(cohort.guildId, m.userId, access);
      if (res.status === 201 || res.status === 204) {
        if (m.roleSnapshot) {
          const roles = (m.roleSnapshot as any).roleIds as string[] | undefined;
          if (roles?.length) await patchRoles(cohort.guildId, m.userId, roles);
        }
      }
    } catch (e: any) {
      console.error('restore member failed', m.userId, e?.message);
    }

    done++;
    await prisma.restoreJob.update({ where: { id: jobId }, data: { progress: Math.round((done / members.length) * 100) } });
    await sleep(300);
  }

  await prisma.restoreJob.update({ where: { id: jobId }, data: { status: 'completed', progress: 100 } });
}, { connection });
