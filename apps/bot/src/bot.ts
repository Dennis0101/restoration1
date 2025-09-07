// apps/bot/src/bot.ts
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import axios, { type AxiosResponse } from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

// v15 대비: ready → clientReady
client.once('clientReady', () => {
  console.log(`🤖 ${client.user?.tag} ready`);
});

// ephemeral 옵션 deprecated → flags 사용
const EPHEMERAL = 64; // MessageFlags.Ephemeral

// ---- API BASE URL 정규화 & axios 인스턴스 ----
function normalizedBase() {
  const raw = process.env.API_BASE_URL || '';
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`; // 프로토콜 보정
  return withProto.replace(/\/+$/, ''); // 끝 슬래시 제거
}
const API_BASE = normalizedBase();

const http = axios.create({
  baseURL: API_BASE,
  timeout: 10_000,
});

// 공통 헬퍼: URL 조립 + 자세한 에러로그 + 5xx 재시도
function joinPath(path: string) {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function postJson(path: string, data: any, retries = 2): Promise<AxiosResponse<any>> {
  const url = joinPath(path);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await http.post(url, data, { headers: { 'Content-Type': 'application/json' } });
    } catch (e: any) {
      const status = e?.response?.status;
      const body = e?.response?.data;
      console.error(`HTTP POST ${url} failed [${status ?? 'no-status'}]:`, body ?? e?.message);
      if (status && status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('unreachable');
}

async function getJson(path: string, retries = 2): Promise<AxiosResponse<any>> {
  const url = joinPath(path);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await http.get(url);
    } catch (e: any) {
      const status = e?.response?.status;
      const body = e?.response?.data;
      console.error(`HTTP GET ${url} failed [${status ?? 'no-status'}]:`, body ?? e?.message);
      if (status && status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('unreachable');
}

// ---- 슬래시 핸들러 ----
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;

  try {
    if (i.commandName === 'issuekey') {
      await i.deferReply({ flags: EPHEMERAL });
      const resp = await postJson('/cohort', { guildId: i.guildId });
      const data = resp.data;
      const key = data.key;
      const link = `${API_BASE}/oauth/login?key=${encodeURIComponent(key)}`;
      await i.editReply({ content: `🔑 복구키: \`${key}\`\n동의 링크: ${link}` });
    }

    if (i.commandName === 'restore') {
      const key = i.options.getString('key', true);
      await i.deferReply({ flags: EPHEMERAL });
      const resp = await postJson(`/restore/${encodeURIComponent(key)}`, {});
      const data = resp.data;
      await i.editReply({ content: `⏳ 복구 시작! Job ID: \`${data.jobId}\`` });
    }

    if (i.commandName === 'status') {
      const job = i.options.getString('job', true);
      const resp = await getJson(`/status/${encodeURIComponent(job)}`);
      const data = resp.data;
      await i.reply({
        flags: EPHEMERAL,
        content: `상태: ${data.status} (${data.progress}%) ${data.error ?? ''}`,
      });
    }

    if (i.commandName === 'verify_msg') {
      const url = `${API_BASE}/verify?guild=${i.guildId}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel('인증하기').setStyle(ButtonStyle.Link).setURL(url),
      );
      const embed = new EmbedBuilder()
        .setTitle('Swasd Restoration | 복구봇')
        .setDescription(`[여기](${url})에서 인증을 완료하세요.`)
        .setColor(0x5865f2);
      await i.reply({ embeds: [embed], components: [row] });
    }

    if (i.commandName === 'set_log') {
      const ch = i.options.getChannel('channel', true);
      await i.reply({ flags: EPHEMERAL, content: `🪵 로그 채널: <#${ch.id}> (저장 중...)` });
      await prisma.guildSettings.upsert({
        where: { guildId: i.guildId! },
        create: { guildId: i.guildId!, logChannelId: ch.id },
        update: { logChannelId: ch.id },
      });
      await i.editReply({ content: `🪵 로그 채널 설정 완료: <#${ch.id}>` });
    }

    if (i.commandName === 'set_role') {
      const role = i.options.getRole('role', true);
      await i.reply({ flags: EPHEMERAL, content: `✅ 인증 역할: <@&${role.id}> (저장 중...)` });
      await prisma.guildSettings.upsert({
        where: { guildId: i.guildId! },
        create: { guildId: i.guildId!, verifiedRoleId: role.id },
        update: { verifiedRoleId: role.id },
      });
      await i.editReply({ content: `✅ 인증 역할 설정 완료: <@&${role.id}>` });
    }
  } catch (e: any) {
    console.error(e);
    const msg = '❌ 오류: ' + (e?.response?.data?.error ?? e?.message ?? 'unknown');
    if (i.deferred || i.replied) await i.editReply({ content: msg });
    else await i.reply({ flags: EPHEMERAL, content: msg });
  }
});

client.login(process.env.DISCORD_TOKEN);
