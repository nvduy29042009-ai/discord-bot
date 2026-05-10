require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const {
  joinVoiceChannel
} = require('@discordjs/voice');

const Database = require('better-sqlite3');
const express = require('express');

const TOKEN = process.env.TOKEN;

// ===== CHANNEL =====
const CAR_CHANNEL_ID = "1500703920992030731";

// ROOM VOICE BẮT BUỘC
const REQUIRED_VOICE_CHANNEL_ID = "1462502093523779747";

// ROOM BOT NGỒI
const BOT_VOICE_CHANNEL_ID = "1462502093523779747";

// ===== BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new Database('data.db');

let menuMessage = null;

// ===== ROLE =====
const ALLOWED_ROLES = [
  "Phó Cục trưởng LSPD",
  "Cục trưởng LSPD",
  "Phòng Hành Chánh"
];

function hasPermission(member) {
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.name));
}

// ===== FORMAT =====
function formatTime(ms) {

  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;

  return `${h} giờ ${mm} phút`;
}

function getVNTime(ts) {

  return new Date(ts).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh'
  });
}

// ===== CHECK VOICE =====
function isInRequiredVoice(member) {
  return member?.voice?.channelId === REQUIRED_VOICE_CHANNEL_ID;
}

// ===== X2 ĐÊM =====
function calcDurationWithNightBonus(start, end) {

  let total = 0;
  let current = start;

  while (current < end) {

    const next = Math.min(current + 60000, end);

    const hour = parseInt(
      new Date(current).toLocaleString("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "numeric",
        hour12: false
      })
    );

    const isNight = (hour >= 23 || hour < 6);

    const diff = next - current;

    total += isNight ? diff * 2 : diff;

    current = next;
  }

  return total;
}

// ===== DATABASE =====
db.prepare(`
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER DEFAULT 0,
  last_voice_check INTEGER DEFAULT 0
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS pending (
  user_id TEXT PRIMARY KEY,
  action TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS cars (
  user_id TEXT
)
`).run();

// ===== STATUS =====
function getOnDutyCount() {

  return db.prepare(`
    SELECT COUNT(*) as c
    FROM shifts
    WHERE end_time IS NULL
  `).get().c;
}

async function updateBotStatus() {

  if (!client.user) return;

  const count = getOnDutyCount();

  client.user.setActivity({
    name: `${count} PD đang trực`,
    type: 3
  });

  try {

    const guild = client.guilds.cache.first();

    if (!guild) return;

    const me = guild.members.me;

    if (!me) return;

    await me.setNickname(`🎧 ${count} PD ĐANG TRỰC`);

  } catch (err) {
    console.log(err);
  }
}

// ===== MENU =====
client.on('messageCreate', async (msg) => {

  if (msg.author.bot) return;

  if (msg.content === '!menu') {

    await msg.delete().catch(() => {});

    if (menuMessage) {

      try {
        await menuMessage.delete();
      } catch {}
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 BẢNG CHẤM CÔNG L.S.P.D')
      .setColor('Blue')
      .addFields({
        name: '👮 On Duty',
        value: `${getOnDutyCount()} người`
      })
      .setDescription(
        `⚠️ Khi ONDUTY bắt buộc phải ngồi đúng room voice:\n<#${REQUIRED_VOICE_CHANNEL_ID}>\n\nNếu không vào room sẽ KHÔNG tính thời gian.`
      );

    const row = new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId('start')
        .setLabel('🟢 VÀO CA TRỰC')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('end')
        .setLabel('🔴 KẾT THÚC CA TRỰC')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('tong')
        .setLabel('📊 TỔNG GIỜ ONDUTY')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('cars')
        .setLabel('🚗 TỔNG XE ĐÃ GIAM')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('reset')
        .setLabel('🔁 RESET DUTY & XE GIAM')
        .setStyle(ButtonStyle.Danger)
    );

    menuMessage = await msg.channel.send({
      embeds: [embed],
      components: [row]
    });
  }
});

// ===== BUTTON =====
client.on('interactionCreate', async (i) => {

  if (!i.isButton()) return;

  const id = i.user.id;

  // ===== START =====
  if (i.customId === 'start') {

    const member = await i.guild.members.fetch(i.user.id);

    if (!isInRequiredVoice(member)) {

      return i.reply({
        content: `❌ Bạn phải vào room <#${REQUIRED_VOICE_CHANNEL_ID}>`,
        ephemeral: true
      });
    }

    db.prepare(`
      INSERT OR REPLACE INTO pending
      VALUES (?, ?)
    `).run(id, 'start');

    return i.reply({
      content: '📸 GỬI ẢNH VÀO CA',
      ephemeral: true
    });
  }

  // ===== END =====
  if (i.customId === 'end') {

    db.prepare(`
      INSERT OR REPLACE INTO pending
      VALUES (?, ?)
    `).run(id, 'end');

    return i.reply({
      content: '📸 GỬI ẢNH KẾT THÚC',
      ephemeral: true
    });
  }

  // ===== TỔNG GIỜ =====
  if (i.customId === 'tong') {

    const rows = db.prepare(`
      SELECT user_id, SUM(duration) as total
      FROM shifts
      GROUP BY user_id
    `).all();

    let text = '';

    let total = 0;

    for (const r of rows) {

      text += `<@${r.user_id}>: ${formatTime(r.total || 0)}\n`;

      total += r.total || 0;
    }

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 TỔNG GIỜ ONDUTY')
          .setDescription(text || 'Không có dữ liệu')
          .addFields({
            name: 'Tổng',
            value: formatTime(total)
          })
      ]
    });
  }

  // ===== TỔNG XE =====
  if (i.customId === 'cars') {

    const rows = db.prepare(`
      SELECT user_id, COUNT(*) as total
      FROM cars
      GROUP BY user_id
    `).all();

    let text = '';

    for (const r of rows) {
      text += `<@${r.user_id}>: ${r.total} xe\n`;
    }

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🚗 TỔNG GIAM XE')
          .setDescription(text || 'Không có dữ liệu')
      ]
    });
  }

  // ===== RESET =====
  if (i.customId === 'reset') {

    if (!hasPermission(i.member)) {

      return i.reply({
        content: '❌ Không có quyền',
        ephemeral: true
      });
    }

    const row = new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId('confirm_reset')
        .setLabel('✅ XÁC NHẬN RESET')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('cancel_reset')
        .setLabel('❌ HỦY')
        .setStyle(ButtonStyle.Secondary)
    );

    return i.reply({
      content: '⚠️ Bạn có chắc muốn reset?',
      components: [row],
      ephemeral: true
    });
  }

  // ===== CONFIRM RESET =====
  if (i.customId === 'confirm_reset') {

    db.prepare(`DELETE FROM shifts`).run();
    db.prepare(`DELETE FROM cars`).run();

    await updateBotStatus();

    return i.update({
      content: '✅ ĐÃ RESET',
      components: []
    });
  }

  // ===== CANCEL RESET =====
  if (i.customId === 'cancel_reset') {

    return i.update({
      content: '❌ Đã hủy',
      components: []
    });
  }
});

// ===== ADD GIỜ =====
client.on('messageCreate', async (msg) => {

  if (msg.author.bot) return;

  if (!msg.content.startsWith('!add')) return;

  if (!hasPermission(msg.member)) {
    return msg.reply('❌ Không có quyền');
  }

  const args = msg.content.split(' ');

  const user = msg.mentions.users.first();

  const hours = parseFloat(args[2]);

  if (!user || isNaN(hours) || hours <= 0) {
    return msg.reply('❌ Dùng: !add @user 3');
  }

  const endTime = Date.now();

  const startTime = endTime - (hours * 60 * 60 * 1000);

  const duration = calcDurationWithNightBonus(startTime, endTime);

  db.prepare(`
    INSERT INTO shifts (
      user_id,
      start_time,
      end_time,
      duration
    )
    VALUES (?, ?, ?, ?)
  `).run(user.id, startTime, endTime, duration);

  msg.reply(`✅ Đã cộng ${hours} giờ cho <@${user.id}>`);
});

// ===== ADD XE =====
client.on('messageCreate', async (msg) => {

  if (msg.author.bot) return;

  if (!msg.content.startsWith('!xe')) return;

  if (!hasPermission(msg.member)) {
    return msg.reply('❌ Không có quyền');
  }

  const args = msg.content.split(' ');

  const user = msg.mentions.users.first();

  const amount = parseInt(args[2]);

  if (!user || isNaN(amount) || amount <= 0) {
    return msg.reply('❌ Dùng: !xe @user 5');
  }

  for (let i = 0; i < amount; i++) {

    db.prepare(`
      INSERT INTO cars (user_id)
      VALUES (?)
    `).run(user.id);
  }

  msg.reply(`🚗 Đã cộng ${amount} xe cho <@${user.id}>`);
});

// ===== HANDLE ẢNH =====
client.on('messageCreate', async (msg) => {

  if (msg.author.bot) return;

  const pending = db.prepare(`
    SELECT * FROM pending
    WHERE user_id=?
  `).get(msg.author.id);

  if (!pending) return;

  const now = Date.now();

  const attachment = msg.attachments.first();

  // ===== START =====
  if (pending.action === 'start') {

    const member = await msg.guild.members.fetch(msg.author.id);

    if (!isInRequiredVoice(member)) {
      return msg.reply(`❌ Bạn chưa vào room voice`);
    }

    db.prepare(`
      INSERT INTO shifts (
        user_id,
        start_time,
        last_voice_check
      )
      VALUES (?, ?, ?)
    `).run(msg.author.id, now, now);

    db.prepare(`
      DELETE FROM pending
      WHERE user_id=?
    `).run(msg.author.id);

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('🟢 VÀO CA')
      .setThumbnail(msg.author.displayAvatarURL())
      .addFields(
        {
          name: '👤 Nhân sự',
          value: msg.author.username
        },
        {
          name: '🕒 Thời gian',
          value: getVNTime(now)
        }
      );

    if (attachment) {
      embed.setImage(attachment.url);
    }

    msg.channel.send({
      embeds: [embed]
    });

    await updateBotStatus();
  }
 // ===== END =====
else if (pending.action === 'end') {

  const row = db.prepare(`
    SELECT * FROM shifts
    WHERE user_id=?
    AND end_time IS NULL
  `).get(msg.author.id);

  if (!row) {
    return msg.reply('❌ CHƯA VÀO CA');
  }

  const member = await msg.guild.members.fetch(msg.author.id);

  let duration = row.duration || 0;

  if (isInRequiredVoice(member)) {

    duration += calcDurationWithNightBonus(
      row.last_voice_check,
      now
    );
  }

  db.prepare(`
    UPDATE shifts
    SET end_time=?, duration=?
    WHERE id=?
  `).run(now, duration, row.id);

  db.prepare(`
    DELETE FROM pending
    WHERE user_id=?
  `).run(msg.author.id);

  const embed = new EmbedBuilder()
    .setColor('Red')
    .setTitle('🔴 KẾT THÚC CA')
    .setThumbnail(msg.author.displayAvatarURL())
    .addFields(
      {
        name: '👤 Nhân sự',
        value: msg.author.username
      },
      {
        name: '🕒 Vào ca',
        value: getVNTime(row.start_time)
      },
      {
        name: '🕒 Kết thúc',
        value: getVNTime(now)
      },
      {
        name: '🎧 Voice hợp lệ',
        value: formatTime(duration)
      },
      {
        name: '✅ ONDUTY được tính',
        value: formatTime(duration)
      }
    );

  if (attachment) {
    embed.setImage(attachment.url);
  }

  msg.channel.send({
    embeds: [embed]
  });

 await updateBotStatus();
}

});
// ===== AUTO CHECK VOICE =====
setInterval(async () => {

  const rows = db.prepare(`
    SELECT * FROM shifts
    WHERE end_time IS NULL
  `).all();

  const now = Date.now();

  for (const row of rows) {

    try {

      const guild = client.guilds.cache.first();

      if (!guild) continue;

      let member;

      try {

        member = await guild.members.fetch(row.user_id);

      } catch {
        continue;
      }

      if (!member) continue;

      // ===== ĐANG Ở ROOM =====
      if (isInRequiredVoice(member)) {

        const added = calcDurationWithNightBonus(
          row.last_voice_check,
          now
        );

        const newDuration = (row.duration || 0) + added;

        db.prepare(`
          UPDATE shifts
          SET duration=?, last_voice_check=?
          WHERE id=?
        `).run(newDuration, now, row.id);
      }

      // ===== KHÔNG Ở ROOM =====
      else {

        db.prepare(`
          UPDATE shifts
          SET last_voice_check=?
          WHERE id=?
        `).run(now, row.id);

        try {

          const diff = now - row.last_voice_check;

          if (diff >= 30 * 60 * 1000) {

            await member.send(
              `⚠️ Bạn đang ONDUTY nhưng chưa vào room voice <#${REQUIRED_VOICE_CHANNEL_ID}>`
            );
          }

        } catch {}
      }

    } catch (err) {
      console.log(err);
    }
  }

}, 60000);

// ===== ĐẾM XE =====
client.on('messageCreate', async (msg) => {

  if (msg.author.bot) return;

  if (msg.channel.id !== CAR_CHANNEL_ID) return;

  if (msg.attachments.size === 0) return;

  db.prepare(`
    INSERT INTO cars (user_id)
    VALUES (?)
  `).run(msg.author.id);
});

// ===== READY =====
client.once('ready', async () => {

  console.log('✅ BOT READY');

  await updateBotStatus();

  try {

    const guild = client.guilds.cache.first();

    joinVoiceChannel({
      channelId: BOT_VOICE_CHANNEL_ID,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });

    console.log('🎧 BOT ĐÃ VÀO VOICE');

  } catch (err) {
    console.log(err);
  }
});

// ===== SERVER =====
const app = express();

app.get('/', (req, res) => {
  res.send('Bot running');
});

app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(TOKEN);