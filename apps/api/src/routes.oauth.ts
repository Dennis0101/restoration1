import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { oauthExchange, me, /*oauthRefresh,*/ } from './discord';

const prisma = new PrismaClient();
export const oauthRouter = Router();
const redirect = process.env.OAUTH_REDIRECT_URI!;

oauthRouter.get('/login', (req, res) => {
  const key = String(req.query.key ?? '');
  if (!key) return res.status(400).send('key required');
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', process.env.DISCORD_CLIENT_ID!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('scope', 'identify guilds.join');
  url.searchParams.set('state', key);
  res.redirect(url.toString());
});

oauthRouter.get('/callback', async (req, res) => {
  try {
    const code = String(req.query.code ?? '');
    const key  = String(req.query.state ?? '');
    if (!code || !key) return res.status(400).send('missing code/state');

    const cohort = await prisma.recoveryCohort.findUnique({ where: { key } });
    if (!cohort) return res.status(400).send('invalid key');

    const t = await oauthExchange(code, redirect);
    const user = await me(t.access_token);

    let roleSnapshot: any = null;
    const member = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 1
    `); // 스냅샷은 워커에서 다시 복구하므로 MVP에선 생략 or 추후 디스코드 멤버 조회 사용

    await prisma.recoveryMember.upsert({
      where: { cohortId_userId: { cohortId: cohort.id, userId: user.id } },
      update: {
        accessTokenEnc: Buffer.from(t.access_token, 'utf8').toString('base64'),
        refreshTokenEnc: Buffer.from(t.refresh_token, 'utf8').toString('base64'),
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot
      },
      create: {
        cohortId: cohort.id, userId: user.id,
        accessTokenEnc: Buffer.from(t.access_token, 'utf8').toString('base64'),
        refreshTokenEnc: Buffer.from(t.refresh_token, 'utf8').toString('base64'),
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot
      }
    });

    res.send('✅ 등록 완료! 복구 시 자동 참여/역할 복원이 가능합니다.');
  } catch (e: any) {
    res.status(500).send('OAuth error: ' + (e.response?.data?.error_description ?? e.message));
  }
});
