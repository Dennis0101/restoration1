// apps/bot/src/registerCommands.ts
import { REST, Routes, Client, GatewayIntentBits, TextChannel } from "discord.js";
import { commands } from "./commands";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

async function main() {
  try {
    // ✅ 글로벌 명령어 등록
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
      { body: commands }
    );
    console.log("✅ Global slash commands registered");

    // ✅ 디코 클라이언트 로그인
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(process.env.DISCORD_TOKEN!);

    client.once("ready", async () => {
      console.log(`Logged in as ${client.user?.tag}`);

      const channelId = "1413350627936833637"; // 🔑 채널 ID
      const channel = await client.channels.fetch(channelId);

      if (channel && channel.isTextBased()) {
        (channel as TextChannel).send("✅ 글로벌 슬래시 명령어 등록 완료!");
      }

      client.destroy(); // 작업 끝나면 봇 종료
    });
  } catch (err) {
    console.error("❌ 명령어 등록 실패:", err);
  }
}

main();
