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

// ===== TOKEN =====
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.log("❌ THIẾU TOKEN");
  process.exit(1);
}

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===== DATABASE =====
const db = new Database('data.db');

db.prepare(`
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  type TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER,
  start_img TEXT,
  end_img TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS pending (
  user_id TEXT PRIMARY KEY,
  action TEXT,
  type TEXT
)
`).run();

// ===== BIẾN MENU =====
let menuMessage = null;

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} giờ ${mm} phút`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('vi-VN');
}

// ===== TÍNH GIỜ =====
function calcDurationWithNightBonus(start, end) {
  let total = 0;
  let current = start;

  while (current < end) {
    const next = Math.min(current + 60000, end);
    const hour = new Date(current).getHours();
    const isNight = (hour >= 23 || hour < 6);
    const diff = next - current;

    total += isNight ? diff * 2 : diff;
    current = next;
  }

  return total;
}

// ===== READY =====
client.once('ready', () => {
  console.log('✅ BOT READY');
});

// ===== MENU =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === '!menu') {

    if (menuMessage) {
      try { await menuMessage.delete(); } catch {}
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 BẢNG CHẤM CÔNG')
      .setColor('Blue');

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('benhvien').setLabel('🏥 Bệnh viện').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('lspd').setLabel('🚓 LSPD').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 Kết thúc').setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tong_bv').setLabel('📊 Tổng BV').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tong_lspd').setLabel('📊 Tổng LSPD').setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reset_bv').setLabel('🔁 Reset BV').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_lspd').setLabel('🔁 Reset LSPD').setStyle(ButtonStyle.Danger)
    );

    menuMessage = await msg.channel.send({
      embeds: [embed],
      components: [row1, row2, row3]
    });

    return;
  }

  // ===== XỬ LÝ ẢNH =====
  const id = msg.author.id;
  const pending = db.prepare(`SELECT * FROM pending WHERE user_id=?`).get(id);

  if (!pending) return;

  let attachment = msg.attachments.first();

  if (!attachment && msg.content.includes("http")) {
    attachment = { url: msg.content };
  }

  if (!attachment) {
    return msg.reply('📸 Gửi ảnh (file hoặc link)');
  }

  const img = attachment.url;

  // ===== START =====
  if (pending.action === 'start') {

    const check = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (check) {
      db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);
      return msg.reply('⚠️ Bạn đang trong ca');
    }

    const now = Date.now();

    db.prepare(`
      INSERT INTO shifts (user_id, type, start_time, start_img)
      VALUES (?, ?, ?, ?)
    `).run(id, pending.type, now, img);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);

    msg.channel.send(
`🟢 ${msg.author.username} vào ca ${pending.type.toUpperCase()}
🕒 ${formatDate(now)}`
    );
  }

  // ===== END =====
  else if (pending.action === 'end') {

    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (!row) {
      db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);
      return msg.reply('❌ Bạn chưa vào ca');
    }

    const endTime = Date.now();
    const duration = calcDurationWithNightBonus(row.start_time, endTime);

    db.prepare(`
      UPDATE shifts SET end_time=?, duration=?, end_img=? WHERE id=?
    `).run(endTime, duration, img, row.id);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);

    msg.channel.send(
`🔴 ${msg.author.username} kết thúc (${row.type})
🕒 Vào: ${formatDate(row.start_time)}
🕒 Ra: ${formatDate(endTime)}
⏱ ${formatTime(duration)}`
    );
  }
});

// ===== BUTTON =====
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  const id = i.user.id;

  if (i.customId === 'benhvien') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`).run(id, 'start', 'benhvien');
    return i.reply({ content: '📸 Gửi ảnh vào ca BV', ephemeral: true });
  }

  if (i.customId === 'lspd') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`).run(id, 'start', 'lspd');
    return i.reply({ content: '📸 Gửi ảnh vào ca LSPD', ephemeral: true });
  }

  if (i.customId === 'end') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`).run(id, 'end', null);
    return i.reply({ content: '📸 Gửi ảnh kết thúc', ephemeral: true });
  }

  // ===== TỔNG BV =====
  if (i.customId === 'tong_bv') {
    const rows = db.prepare(`
      SELECT user_id, SUM(duration) as total
      FROM shifts WHERE type='benhvien'
      GROUP BY user_id
    `).all();

    let text = '';
    let total = 0;

    for (const r of rows) {
      let name = r.user_id;
      const member = await i.guild.members.fetch(r.user_id).catch(() => null);
      if (member) name = member.displayName;

      text += `👤 ${name}: ${formatTime(r.total)}\n`;
      total += r.total;
    }

    if (!text) text = 'Không có dữ liệu';

    const embed = new EmbedBuilder()
      .setTitle('🏥 TỔNG BỆNH VIỆN')
      .setDescription(text)
      .addFields({ name: '⏱ Tổng', value: formatTime(total) });

    return i.reply({ embeds: [embed], ephemeral: true });
  }

  // ===== TỔNG LSPD =====
  if (i.customId === 'tong_lspd') {
    const rows = db.prepare(`
      SELECT user_id, SUM(duration) as total
      FROM shifts WHERE type='lspd'
      GROUP BY user_id
    `).all();

    let text = '';
    let total = 0;

    for (const r of rows) {
      let name = r.user_id;
      const member = await i.guild.members.fetch(r.user_id).catch(() => null);
      if (member) name = member.displayName;

      text += `👤 ${name}: ${formatTime(r.total)}\n`;
      total += r.total;
    }

    if (!text) text = 'Không có dữ liệu';

    const embed = new EmbedBuilder()
      .setTitle('🚓 TỔNG LSPD')
      .setDescription(text)
      .addFields({ name: '⏱ Tổng', value: formatTime(total) });

    return i.reply({ embeds: [embed], ephemeral: true });
  }

  // ===== RESET =====
  if (i.customId === 'reset_bv') {
if (!i.member.roles.cache.some(r => r.name === "Admin")) {
      return i.reply({ content: "❌ Chỉ admin", ephemeral: true });
    }
    db.prepare(`DELETE FROM shifts WHERE type='benhvien'`).run();
    return i.reply({ content: '✅ Reset BV', ephemeral: true });
  }

  if (i.customId === 'reset_lspd') {
    if (!i.member.permissions.has("Administrator")) {
      return i.reply({ content: "❌ Chỉ admin", ephemeral: true });
    }
    db.prepare(`DELETE FROM shifts WHERE type='lspd'`).run();
    return i.reply({ content: '✅ Reset LSPD', ephemeral: true });
  }
});

// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot running'));
app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(TOKEN);