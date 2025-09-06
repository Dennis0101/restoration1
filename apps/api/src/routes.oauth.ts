// apps/api/src/routes.oauth.ts
import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import axios from 'axios';

export const oauthRouter = Router();              // ✅ named export
const prisma = new PrismaClient();
const redirect = process.env.OAUTH_REDIRECT_URI!;

// OAuth 로그인 링크 발급 (/oauth/login?key=...)
oauthRouter.get('/login', (req: Request, res: Response) => {
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

// OAuth 콜백
oauthRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code ?? '');
    const key  = String(req.query.state ?? '');
    if (!code || !key) return res.status(400).send('missing code/state');

    const cohort = await prisma.recoveryCohort.findUnique({ where: { key } });
    if (!cohort) return res.status(400).send('invalid key');

    // 토큰 교환
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const t = tokenRes.data as {
      access_token: string; refresh_token: string; scope: string; expires_in: number;
    };

    // 유저 정보
    const meRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${t.access_token}` }
    });
    const user = meRes.data as { id: string };

    // 토큰 저장 (roleSnapshot은 JSON null로 명시)
    await prisma.recoveryMember.upsert({
      where: { cohortId_userId: { cohortId: cohort.id, userId: user.id } },
      update: {
        accessTokenEnc: Buffer.from(t.access_token, 'utf8').toString('base64'),
        refreshTokenEnc: Buffer.from(t.refresh_token, 'utf8').toString('base64'),
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot: Prisma.JsonNull
      },
      create: {
        cohortId: cohort.id,
        userId: user.id,
        accessTokenEnc: Buffer.from(t.access_token, 'utf8').toString('base64'),
        refreshTokenEnc: Buffer.from(t.refresh_token, 'utf8').toString('base64'),
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot: Prisma.JsonNull
      }
    });

    res.send('✅ 등록 완료! 복구 시 자동 참여/역할 복원이 가능합니다.');
  } catch (e: any) {
    console.error(e);
    res.status(500).send('OAuth error: ' + (e.response?.data?.error_description ?? e.message));
  }
});
