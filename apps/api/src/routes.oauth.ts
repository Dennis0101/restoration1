// apps/api/src/routes.oauth.ts
import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import axios from 'axios';

export const oauthRouter = Router();
const prisma = new PrismaClient();

// ----- ENV & helpers -----
const CLIENT_ID     = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI  = process.env.OAUTH_REDIRECT_URI || '';

function ensureEnv(res: Response) {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    res.status(500).send('OAuth env missing: DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / OAUTH_REDIRECT_URI');
    return false;
  }
  return true;
}
function html(body: string) {
  return `<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui, -apple-system, 'Segoe UI', Roboto, Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;padding:24px;line-height:1.5}</style>${body}`;
}
function isValidState(s: string) {
  return typeof s === 'string' && s.length >= 4 && s.length <= 128;
}

// ----- OAuth 로그인 링크 발급 (/oauth/login?key=...) -----
oauthRouter.get('/oauth/login', (req: Request, res: Response) => {
  if (!ensureEnv(res)) return;

  const key = String(req.query.key ?? '');
  if (!isValidState(key)) {
    return res.status(400).send(html('<h2>잘못된 요청</h2><p>state(key)가 유효하지 않습니다.</p>'));
  }

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'identify guilds.join');
  url.searchParams.set('state', key);
  // 선택 옵션 (사용자에게 강제 동의 화면): url.searchParams.set('prompt', 'consent');

  return res.redirect(url.toString());
});

// ----- OAuth 콜백 (/oauth/callback) -----
oauthRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  if (!ensureEnv(res)) return;

  try {
    const code = String(req.query.code ?? '');
    const key  = String(req.query.state ?? '');

    if (!code || !isValidState(key)) {
      return res.status(400).send(html('<h2>잘못된 요청</h2><p>code/state가 없습니다.</p>'));
    }

    // state(key) 확인
    const cohort = await prisma.recoveryCohort.findUnique({ where: { key } });
    if (!cohort) {
      return res.status(400).send(html('<h2>세션 만료</h2><p>유효하지 않은 복구키입니다.</p>'));
    }

    // 토큰 교환
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    const t = tokenRes.data as {
      access_token: string; refresh_token: string; scope: string; expires_in: number;
    };

    // 유저 정보
    const meRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${t.access_token}` },
      timeout: 10000
    });
    const user = meRes.data as { id: string };

    // 토큰 저장 (여기서는 간단히 base64로 저장; 운영 시 별도 암호화 권장)
    const accessEnc  = Buffer.from(t.access_token,  'utf8').toString('base64');
    const refreshEnc = Buffer.from(t.refresh_token, 'utf8').toString('base64');

    await prisma.recoveryMember.upsert({
      where: { cohortId_userId: { cohortId: cohort.id, userId: user.id } },
      update: {
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot: Prisma.JsonNull,
      },
      create: {
        cohortId: cohort.id,
        userId: user.id,
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot: Prisma.JsonNull,
      }
    });

    return res.send(html('<h2>✅ 등록 완료</h2><p>이제 복구 시 자동 참여/역할 복원이 가능합니다. 창을 닫아주세요.</p>'));
  } catch (e: any) {
    console.error('OAuth callback error:', e?.response?.data || e?.message || e);
    const msg = e?.response?.data?.error_description ?? e?.message ?? 'unknown error';
    return res.status(500).send(html(`<h2>OAuth 오류</h2><p>${String(msg)}</p>`));
  }
});
