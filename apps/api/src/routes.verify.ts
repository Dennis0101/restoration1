import { Router, Request, Response, urlencoded } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { renderCaptcha } from './render';
import { postToChannel, patchRoles } from './discord';

export const verifyRouter = Router();
const prisma = new PrismaClient();

verifyRouter.get('/verify', async (req: Request, res: Response) => {
  const guildId = String(req.query.guild ?? '');
  const userId = String(req.query.user ?? '');
  if (!guildId) return res.status(400).send('Missing guild');
  res.setHeader('Content-Type', 'text/html').send(
    renderCaptcha(process.env.HCAPTCHA_SITEKEY!, guildId, userId || undefined)
  );
});

verifyRouter.post('/verify', urlencoded({ extended: true }), async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string>;
    const token = body['h-captcha-response'];
    const guildId = String(body.guildId ?? '');
    const userId = String(body.userId ?? '');
    if (!token || !guildId || !userId) return res.status(400).send('Bad request');

    const { data: cap } = await axios.post(
      'https://hcaptcha.com/siteverify',
      new URLSearchParams({ secret: process.env.HCAPTCHA_SECRET!, response: token }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    if (!cap.success) return res.status(400).send('Captcha failed');

    const set = await prisma.guildSettings.findUnique({ where: { guildId } });
    const passed = true;

    await prisma.verificationLog.create({ data: { guildId, userId, passed, ip: req.ip, ua: String(req.headers['user-agent'] ?? '') } });

    if (passed && set?.verifiedRoleId) {
      await patchRoles(guildId, userId, [set.verifiedRoleId]);
    }
    if (set?.logChannelId) {
      await postToChannel(set.logChannelId, {
        embeds: [{
          title: passed ? '✅ 인증 성공' : '❌ 인증 실패',
          fields: [
            { name: '유저', value: `<@${userId}>`, inline: true },
            { name: '길드', value: guildId, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      });
    }
    res.send('인증 완료! 창을 닫아주세요.');
  } catch (e: any) {
    console.error(e);
    res.status(500).send('Server error');
  }
});
