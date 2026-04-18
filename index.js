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
console.log("TOKEN LENGTH:", TOKEN?.length);
// ===== CHECK TOKEN =====
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

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} giờ ${mm} phút`;
}

// ===== GIỜ ĐÊM =====
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

client.on('shardDisconnect', () => {
  console.log('❌ DISCONNECTED');
});

client.on('shardReconnecting', () => {
  console.log('🔄 RECONNECTING');
});

// ===== MESSAGE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // ===== MENU =====
  if (msg.content === '!menu') {

  const embed = new EmbedBuilder()
    .setTitle('📋 BẢNG CHẤM CÔNG ĐA KHU GTA GO')
    .setColor('Blue');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('benhvien').setLabel('🏥 Bệnh viện').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('lspd').setLabel('🚓 LSPD').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('end').setLabel('🔴 Kết thúc').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('tong').setLabel('📊 Tổng').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reset_bv').setLabel('🔁 Reset BV').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('reset_lspd').setLabel('🔁 Reset LSPD').setStyle(ButtonStyle.Danger)
  );

  return msg.channel.send({
    embeds: [embed],
    components: [row1, row2]
  });
}

  const id = msg.author.id;

// 🔥 DEBUG
console.log("📩 MSG:", msg.content);
console.log("📎 ATTACH SIZE:", msg.attachments.size);

// 🔥 LẤY PENDING
const pending = db.prepare(`SELECT * FROM pending WHERE user_id=?`).get(id);

if (!pending) {
  console.log("❌ KHÔNG CÓ PENDING");
  return;
}

// delay nhẹ
await new Promise(r => setTimeout(r, 500));

// 🔥 LẤY ẢNH
let attachment = msg.attachments.first();

// 🔥 hỗ trợ luôn gửi link ảnh
if (!attachment && msg.content.includes("http")) {
  attachment = { url: msg.content };
}

// ❌ không có ảnh
if (!attachment) {
  console.log("❌ KHÔNG CÓ ẢNH");
  return msg.reply('📸 Gửi ảnh (file hoặc link đều được)');
}

const img = attachment.url;

  // ===== START =====
  if (pending.action === 'start') {

    const check = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (check) {
      db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);
      return msg.reply('⚠️ Bạn đang trong ca');
    }

    db.prepare(`
      INSERT INTO shifts (user_id, type, start_time, start_img)
      VALUES (?, ?, ?, ?)
    `).run(id, pending.type, Date.now(), img);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);

    msg.channel.send(`🟢 ${msg.author.username} vào ca ${pending.type.toUpperCase()}`);
  }

  // ===== END =====
  else if (pending.action === 'end') {
    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (!row) {
      db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);
      return msg.reply('❌ Bạn chưa vào ca');
    }

    const end = Date.now();
    const duration = calcDurationWithNightBonus(row.start_time, end);

    db.prepare(`
      UPDATE shifts SET end_time=?, duration=?, end_img=? WHERE id=?
    `).run(end, duration, img, row.id);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(id);

    msg.channel.send(`🔴 ${msg.author.username} kết thúc (${row.type})
⏱ ${formatTime(duration)}`);
  }
});

// ===== BUTTON =====
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  const id = i.user.id;

  if (i.customId === 'benhvien') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`)
      .run(id, 'start', 'benhvien');
    return i.reply({ content: '📸 Gửi ảnh vào ca BV', ephemeral: true });
  }

  if (i.customId === 'lspd') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`)
      .run(id, 'start', 'lspd');
    return i.reply({ content: '📸 Gửi ảnh vào ca LSPD', ephemeral: true });
  }

  if (i.customId === 'end') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`)
      .run(id, 'end', null);
    return i.reply({ content: '📸 Gửi ảnh kết thúc', ephemeral: true });
  }

  if (i.customId === 'reset_bv') {
    db.prepare(`DELETE FROM shifts WHERE type='benhvien'`).run();
    return i.reply({ content: '✅ Reset BV', ephemeral: true });
  }

  if (i.customId === 'reset_lspd') {
    db.prepare(`DELETE FROM shifts WHERE type='lspd'`).run();
    return i.reply({ content: '✅ Reset LSPD', ephemeral: true });
  }

  if (i.customId === 'tong') {
  const rows = db.prepare(`
    SELECT user_id, type, SUM(duration) as total
    FROM shifts
    GROUP BY user_id, type
  `).all();

  let bv = '';
  let lspd = '';

  for (const r of rows) {
    // 🔥 lấy tên user thay vì ID
    const user = await client.users.fetch(r.user_id).catch(() => null);
    const name = user ? user.username : r.user_id;

    if (r.type === 'benhvien') {
      bv += `👤 ${name}: ${formatTime(r.total)}\n`;
    } else if (r.type === 'lspd') {
      lspd += `👤 ${name}: ${formatTime(r.total)}\n`;
    }
  }

  if (!bv) bv = 'Không có dữ liệu';
  if (!lspd) lspd = 'Không có dữ liệu';

  const embed = new EmbedBuilder()
    .setTitle('📊 TỔNG CHẤM CÔNG')
    .addFields(
      { name: '🏥 BỆNH VIỆN', value: bv, inline: false },
      { name: '🚓 LSPD', value: lspd, inline: false }
    )
    .setColor('Blue');

  return i.reply({ embeds: [embed], ephemeral: true });
}
});
// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(TOKEN).catch(err => {
  console.log("❌ LOGIN ERROR:", err.message);
});