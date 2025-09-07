// apps/bot/src/registerCommands.ts
import { REST, Routes, Client, GatewayIntentBits } from "discord.js";
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

      // 👉 메시지를 보낼 채널 ID 입력해야 함
      const channelId = "1413350627936833637";
      const channel = await client.channels.fetch(channelId);

      if (channel?.isTextBased()) {
        await channel.send("✅ 글로벌 슬래시 명령어 등록 완료!");
      }

      client.destroy(); // 작업 끝나면 봇 종료
    });
  } catch (err) {
    console.error("❌ 명령어 등록 실패:", err);
  }
}

main();
