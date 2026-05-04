require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const Database = require('better-sqlite3');
const express = require('express');

const TOKEN = process.env.TOKEN;

// 🚗 CHANNEL GIAM XE (ID bạn đưa)
const CAR_CHANNEL_ID = "1500703920992030731";

// ===== BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
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

// ===== X2 ĐÊM =====
function calcDurationWithNightBonus(start, end) {
  let total = 0;
  let current = start;

  while (current < end) {
    const next = Math.min(current + 60000, end);

    const hour = parseInt(new Date(current).toLocaleString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "numeric",
      hour12: false
    }));

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
  duration INTEGER
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
  return db.prepare(`SELECT COUNT(*) as c FROM shifts WHERE end_time IS NULL`).get().c;
}

function updateBotStatus() {
  if (!client.user) return;
  client.user.setActivity({
    name: `${getOnDutyCount()} người đang trực`,
    type: 3
  });
}

// ===== MENU =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === '!menu') {

    await msg.delete().catch(() => {});

    if (menuMessage) {
      try { await menuMessage.delete(); } catch {}
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 BẢNG CHẤM CÔNG')
      .setColor('Blue')
      .addFields({
        name: '👮 On Duty',
        value: `${getOnDutyCount()} người`
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start').setLabel('🟢 VÀO CA').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 KẾT THÚC').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tong').setLabel('📊 TỔNG GIỜ').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cars').setLabel('🚗 TỔNG XE').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('reset').setLabel('🔁 RESET').setStyle(ButtonStyle.Danger)
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

  if (i.customId === 'start') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?)`).run(id, 'start');
    return i.reply({ content: '📸 GỬI ẢNH VÀO CA', ephemeral: true });
  }

  if (i.customId === 'end') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?)`).run(id, 'end');
    return i.reply({ content: '📸 GỬI ẢNH KẾT THÚC', ephemeral: true });
  }

  // 📊 TỔNG GIỜ (CÔNG KHAI)
  if (i.customId === 'tong') {
    const rows = db.prepare(`
      SELECT user_id, SUM(duration) as total
      FROM shifts GROUP BY user_id
    `).all();

    let text = '';
    let total = 0;

    for (const r of rows) {
      text += `<@${r.user_id}>: ${formatTime(r.total)}\n`;
      total += r.total;
    }

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 TỔNG GIỜ')
          .setDescription(text || 'Không có dữ liệu')
          .addFields({ name: 'Tổng', value: formatTime(total) })
      ],
      ephemeral: false
    });
  }

  // 🚗 TỔNG XE (CÔNG KHAI)
  if (i.customId === 'cars') {
    const rows = db.prepare(`
      SELECT user_id, COUNT(*) as total
      FROM cars GROUP BY user_id
    `).all();

    let text = '';

    for (const r of rows) {
      text += `<@${r.user_id}>: ${r.total} xe\n`;
    }

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🚗 TỔNG XE GIAM')
          .setDescription(text || 'Không có dữ liệu')
      ],
      ephemeral: false
    });
  }

  // 🔁 RESET
  if (i.customId === 'reset') {
    if (!hasPermission(i.member)) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    db.prepare(`DELETE FROM shifts`).run();
    db.prepare(`DELETE FROM cars`).run();

    return i.reply({ content: "🔁 Đã reset toàn bộ", ephemeral: false });
  }
});

// ===== HANDLE ẢNH =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const pending = db.prepare(`SELECT * FROM pending WHERE user_id=?`).get(msg.author.id);
  if (!pending) return;

  const now = Date.now();
  const attachment = msg.attachments.first();

  if (pending.action === 'start') {

    db.prepare(`INSERT INTO shifts (user_id, start_time) VALUES (?, ?)`)
      .run(msg.author.id, now);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('🟢 VÀO CA')
      .setThumbnail(msg.author.displayAvatarURL())
      .addFields(
        { name: '👤 Nhân sự', value: msg.author.username },
        { name: '🕒 Thời gian', value: getVNTime(now) }
      )
      .setImage(attachment?.url || null);

    msg.channel.send({ embeds: [embed] });

    // 🧹 XOÁ ẢNH
    msg.delete().catch(() => {});

    updateBotStatus();
  }

  else if (pending.action === 'end') {

    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`)
      .get(msg.author.id);

    if (!row) return msg.reply('❌ CHƯA VÀO CA');

    const endTime = now;
    const duration = calcDurationWithNightBonus(row.start_time, endTime);

    db.prepare(`
      UPDATE shifts SET end_time=?, duration=? WHERE id=?
    `).run(endTime, duration, row.id);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('🔴 KẾT THÚC CA')
      .setThumbnail(msg.author.displayAvatarURL())
      .addFields(
        { name: '👤 Nhân sự', value: msg.author.username },
        { name: '🕒 Vào', value: getVNTime(row.start_time) },
        { name: '🕒 Ra', value: getVNTime(endTime) },
        { name: '⏱ Thời gian', value: formatTime(duration) }
      )
      .setImage(attachment?.url || null);

    msg.channel.send({ embeds: [embed] });

    // 🧹 XOÁ ẢNH
    msg.delete().catch(() => {});

    updateBotStatus();
  }
});

// ===== 🚗 ĐẾM XE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.channel.id !== CAR_CHANNEL_ID) return;
  if (msg.attachments.size === 0) return;

  db.prepare(`INSERT INTO cars (user_id) VALUES (?)`)
    .run(msg.author.id);

  console.log(`+1 xe: ${msg.author.username}`);
});

// ===== READY =====
client.once('ready', () => {
  console.log('✅ BOT READY');
  updateBotStatus();
});

// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot running'));
app.listen(process.env.PORT || 3000);

client.login(TOKEN);