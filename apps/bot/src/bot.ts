// apps/bot/src/bot.ts
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  REST,
  Routes,
} from 'discord.js';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { commands } from './commands'; // ← 슬래시 명령어 정의(JSON 배열)

const prisma = new PrismaClient();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

// ---------- A 방법: 부팅 시 자동 등록 ----------
async function registerSlashCommandsOnBoot() {
  const token = process.env.DISCORD_TOKEN!;
  const appId = process.env.DISCORD_CLIENT_ID!;
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    if (process.env.REGISTER_GLOBAL_ON_BOOT === '1') {
      await rest.put(Routes.applicationCommands(appId), { body: commands });
      console.log('✅ Global slash commands registered');
    }

    // 선택: 길드 즉시등록(테스트용, 바로 뜸)
    if (process.env.REGISTER_GUILD_ON_BOOT === '1' && process.env.DEV_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(appId, process.env.DEV_GUILD_ID),
        { body: commands }
      );
      console.log(`⚡ Guild slash commands registered to ${process.env.DEV_GUILD_ID}`);
    }
  } catch (e: any) {
    console.error('❌ Slash command register failed:', e?.response?.data ?? e.message);
  }
}
// ---------------------------------------------

client.once('ready', async () => {
  console.log(`🤖 ${client.user?.tag} ready`);

  // 부팅 시 등록 플래그가 켜져 있으면 실행
  if (process.env.REGISTER_GLOBAL_ON_BOOT === '1' || process.env.REGISTER_GUILD_ON_BOOT === '1') {
    await registerSlashCommandsOnBoot();
  }
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    if (i.commandName === 'issuekey') {
      await i.deferReply({ ephemeral: true });
      const { data } = await axios.post(`${process.env.API_BASE_URL}/cohort`, { guildId: i.guildId });
      const link = `${process.env.API_BASE_URL}/oauth/login?key=${encodeURIComponent(data.key)}`;
      await i.editReply(`🔑 복구키: \`${data.key}\`\n동의 링크: ${link}`);
    }

    if (i.commandName === 'restore') {
      const key = i.options.getString('key', true);
      await i.deferReply({ ephemeral: true });
      const { data } = await axios.post(`${process.env.API_BASE_URL}/restore/${encodeURIComponent(key)}`);
      await i.editReply(`⏳ 복구 시작! Job ID: \`${data.jobId}\``);
    }

    if (i.commandName === 'status') {
      const job = i.options.getString('job', true);
      const { data } = await axios.get(`${process.env.API_BASE_URL}/status/${encodeURIComponent(job)}`);
      await i.reply({ ephemeral: true, content: `상태: ${data.status} (${data.progress}%) ${data.error ?? ''}` });
    }

    if (i.commandName === 'verify_msg') {
      const url = `${process.env.API_BASE_URL}/verify?guild=${i.guildId}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel('인증하기').setStyle(ButtonStyle.Link).setURL(url)
      );
      const embed = new EmbedBuilder()
        .setTitle('Swasd Restoration | 복구봇')
        .setDescription(`[여기](${url})에서 인증을 완료하세요.`)
        .setColor(0x5865f2);
      await i.reply({ embeds: [embed], components: [row] });
    }

    if (i.commandName === 'set_log') {
      const ch = i.options.getChannel('channel', true);
      await prisma.guildSettings.upsert({
        where: { guildId: i.guildId! },
        create: { guildId: i.guildId!, logChannelId: ch.id },
        update: { logChannelId: ch.id },
      });
      await i.reply({ ephemeral: true, content: `🪵 로그 채널: <#${ch.id}>` });
    }

    if (i.commandName === 'set_role') {
      const role = i.options.getRole('role', true);
      await prisma.guildSettings.upsert({
        where: { guildId: i.guildId! },
        create: { guildId: i.guildId!, verifiedRoleId: role.id },
        update: { verifiedRoleId: role.id },
      });
      await i.reply({ ephemeral: true, content: `✅ 인증 역할: <@&${role.id}>` });
    }
  } catch (e: any) {
    console.error(e);
    if (i.deferred || i.replied) await i.editReply('❌ 오류: ' + (e.response?.data?.error ?? e.message));
    else await i.reply({ ephemeral: true, content: '❌ 오류가 발생했습니다.' });
  }
});

client.login(process.env.DISCORD_TOKEN);
