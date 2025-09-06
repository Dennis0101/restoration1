// apps/api/src/routes.oauth.ts
import express, { Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import axios from "axios";

const router = express.Router();
const prisma = new PrismaClient();

// OAuth2 토큰 교환
router.post("/oauth/callback", async (req: Request, res: Response) => {
  try {
    const code = req.body.code as string;

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.OAUTH_REDIRECT_URI!,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const t = tokenRes.data;

    // 유저 정보 가져오기
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    });
    const user = userRes.data;

    // cohort 찾기
    const cohort = await prisma.recoveryCohort.findFirst({
      where: { /* 조건 추가 필요 */ },
    });
    if (!cohort) {
      return res.status(404).json({ error: "Cohort not found" });
    }

    // DB upsert
    await prisma.recoveryMember.upsert({
      where: {
        cohortId_userId: { cohortId: cohort.id, userId: user.id },
      },
      update: {
        accessTokenEnc: Buffer.from(t.access_token, "utf8").toString("base64"),
        refreshTokenEnc: Buffer.from(t.refresh_token, "utf8").toString("base64"),
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot: Prisma.JsonNull, // ✅ 수정
      },
      create: {
        cohortId: cohort.id,
        userId: user.id,
        accessTokenEnc: Buffer.from(t.access_token, "utf8").toString("base64"),
        refreshTokenEnc: Buffer.from(t.refresh_token, "utf8").toString("base64"),
        tokenScope: t.scope,
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        roleSnapshot: Prisma.JsonNull, // ✅ 수정
      },
    });

    return res.json({ ok: true, user });
  } catch (err: any) {
    console.error("OAuth callback failed", err.message);
    return res.status(500).json({ error: "OAuth callback failed" });
  }
});

export default router;
