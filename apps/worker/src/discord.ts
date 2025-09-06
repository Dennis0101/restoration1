import axios from 'axios';
const base = 'https://discord.com/api/v10';

export async function oauthRefresh(refresh: string) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    client_secret: process.env.DISCORD_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    refresh_token: refresh
  });
  const { data } = await axios.post(`${base}/oauth2/token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return data as { access_token:string; refresh_token:string; scope:string; expires_in:number };
}

export const guildsJoin = (guildId:string, userId:string, access:string) =>
  axios.put(`${base}/guilds/${guildId}/members/${userId}`, { access_token: access }, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    validateStatus: () => true
  });

export const patchRoles = (guildId:string, userId:string, roles:string[]) =>
  axios.patch(`${base}/guilds/${guildId}/members/${userId}`, { roles }, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    validateStatus: () => true
  });
