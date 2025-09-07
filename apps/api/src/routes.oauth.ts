// apps/api/src/routes.verify.ts
import { Router, Request, Response, urlencoded, NextFunction } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { renderCaptcha } from './render';
import { postToChannel, patchRoles } from './discord';

export const verifyRouter = Router();
const prisma = new PrismaClient();

// ======= ENV =======
const SITEKEY = process.env.HCAPTCHA_SITEKEY;
const SECRET  = process.env.HCAPTCHA_SECRET;

function ensureCaptchaEnv() {
  return Boolean(SITEKEY && SECRET);
}

function clientIp(req: Request) {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || (req.ip || '').replace('::ffff:', '') || '0.0.0.0';
}

function html(body: string) {
  return `
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;padding:24px;line-height:1.5}
  .ok{color:#16a34a}.err{color:#dc2626}.btn{display:inline-block;margin-top:12px;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;text-decoration:none}
</style>
${body}`;
}

// ======= 간단 레이트리밋 (IP당 초당 5회) =======
const windowMs = 1000;
const maxReq = 5;
const hits = new Map<string, { t: number; c: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
  const now = Date.now();
  const row = hits.get(ip);

  if (!row || now - row.t > windowMs) {
    hits.set(ip, { t: now, c: 1 });
    return next();
  }
  row.c++;
  if (row.c > maxReq) {
    return res.status(429).send(html(`<h2 class="err">Too Many Requests</h2><p>잠시 후 다시 시도해주세요.</p>`));
  }
  next();
}

// ======= 라우트 =======

// 캡챠 폼 페이지
verifyRouter.get('/verify', rateLimit, async (req: Request, res: Response) => {
  try {
    if (!ensureCaptchaEnv()) {
      console.error('❌ HCaptcha keys missing. Set HCAPTCHA_SITEKEY & HCAPTCHA_SECRET.');
      return res.status(500).send(html(`<h2 class="err">서버 설정 오류</h2><p>캡챠 키가 설정되지 않았습니다.</p>`));
    }

    const guildId = String(req.query.guild ?? '');
    const userId  = String(req.query.user ?? '');

    if (!guildId) {
      return res.status(400).send(html(`<h2 class="err">잘못된 요청</h2><p>guild 파라미터가 필요합니다.</p>`));
    }

    // 현재 경로 self-action (배포 환경에서 URL 꼬임 방지)
    res.setHeader('Content-Type', 'text/html')
       .send(renderCaptcha(SITEKEY!, guildId, userId || undefined, '/verify'));
  } catch (e: any) {
    console.error('GET /verify failed:', e?.response?.data || e?.message || e);
    res.status(500).send(html(`<h2 class="err">서버 오류</h2><p>잠시 후 다시 시도해주세요.</p>`));
  }
});

// 캡챠 검증
verifyRouter.post('/verify', rateLimit, urlencoded({ extended: true }), async (req: Request, res: Response) => {
  const ip = clientIp(req);

  try {
    if (!ensureCaptchaEnv()) {
      console.error('❌ HCaptcha keys missing. Set HCAPTCHA_SITEKEY & HCAPTCHA_SECRET.');
      return res.status(500).send(html(`<h2 class="err">서버 설정 오류</h2><p>캡챠 키가 설정되지 않았습니다.</p>`));
    }

    const body    = req.body as Record<string, string>;
    const token   = body['h-captcha-response'];
    const guildId = String(body.guildId ?? '');
    const userId  = String(body.userId ?? '');

    if (!token || !guildId || !userId) {
      return res.status(400).send(html(`<h2 class="err">잘못된 요청</h2><p>필수 값이 빠졌습니다.</p>`));
    }

    // hCaptcha 검증
    const { data: cap } = await axios.post(
      'https://hcaptcha.com/siteverify',
      new URLSearchParams({ secret: SECRET!, response: token }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
    );

    if (!cap?.success) {
      await prisma.verificationLog.create({
        data: {
          guildId, userId, ip,
          ua: String(req.headers['user-agent'] ?? ''),
          passed: false,
          reason: 'captcha_failed'
        }
      });
      return res.status(400).send(html(`<h2 class="err">인증 실패</h2><p>캡챠 검증에 실패했습니다. 다시 시도해주세요.</p>`));
    }

    const set = await prisma.guildSettings.findUnique({ where: { guildId } });
    const passed = true;

    await prisma.verificationLog.create({
      data: {
        guildId, userId, ip,
        ua: String(req.headers['user-agent'] ?? ''),
        passed, reason: null
      }
    });

    if (passed && set?.verifiedRoleId) {
      try {
        await patchRoles(guildId, userId, [set.verifiedRoleId]);
      } catch (e: any) {
        console.error('patchRoles failed:', e?.response?.data || e?.message || e);
      }
    }

    if (set?.logChannelId) {
      try {
        await postToChannel(set.logChannelId, {
          embeds: [{
            title: '✅ 인증 성공',
            fields: [
              { name: '유저', value: `<@${userId}>`, inline: true },
              { name: '길드', value: guildId, inline: true },
              { name: 'IP', value: ip, inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        });
      } catch (e: any) {
        console.error('postToChannel failed:', e?.response?.data || e?.message || e);
      }
    }

    return res.send(html(`<h2 class="ok">인증 완료</h2><p>창을 닫아주세요.</p>`));
  } catch (e: any) {
    console.error('POST /verify error:', e?.response?.data || e?.message || e);
    return res.status(500).send(html(`<h2 class="err">서버 오류</h2><p>잠시 후 다시 시도해주세요.</p>`));
  }
});
