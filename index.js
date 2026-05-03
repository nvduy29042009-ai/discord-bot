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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const db = new Database('data.db');

const ALLOWED_ROLES = [
  "Phó Cục Trưởng LSPD",
  "Cục Trưởng LSPD"
];

// ===== DATABASE =====
db.prepare(`
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  type TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS pending (
  user_id TEXT PRIMARY KEY,
  action TEXT,
  type TEXT
)
`).run();

let menuMessage = null;

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} giờ ${mm} phút`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh'
  });
}

// ===== CHECK ROLE =====
function hasPermission(member) {
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.name));
}

// ===== TÍNH GIỜ X2 =====
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
      .setTitle('📋 BẢNG CHẤM CÔNG LSPD')
      .setColor('Blue');

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lspd').setLabel('🟢 Vào ca trực').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 Kết thúc ca trực').setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tong_lspd').setLabel('📊 Tổng time').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('add_shift').setLabel('➕ Thêm giờ').setStyle(ButtonStyle.Primary)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reset_lspd').setLabel('🔁 Reset').setStyle(ButtonStyle.Danger)
    );

    menuMessage = await msg.channel.send({
      embeds: [embed],
      components: [row1, row2, row3]
    });
  }
});

// ===== BUTTON =====
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  const id = i.user.id;

  if (i.customId === 'lspd') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`).run(id, 'start', 'lspd');
    return i.reply({ content: '📸 Gửi ảnh vào ca', ephemeral: true });
  }

  if (i.customId === 'end') {
    db.prepare(`INSERT OR REPLACE INTO pending VALUES (?, ?, ?)`).run(id, 'end', null);
    return i.reply({ content: '📸 Gửi ảnh kết thúc', ephemeral: true });
  }

  // ===== THÊM GIỜ =====
  if (i.customId === 'add_shift') {
    if (!hasPermission(i.member)) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    return i.reply({
      content: `Nhập theo dạng:\n@user 3 (số giờ)`,
      ephemeral: true
    });
  }

  // ===== RESET =====
  if (i.customId === 'reset_lspd') {
    if (!hasPermission(i.member)) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    db.prepare(`DELETE FROM shifts WHERE type='lspd'`).run();
    return i.reply({ content: '✅ Đã reset', ephemeral: true });
  }

  // ===== TỔNG =====
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
      .setTitle('📊 TỔNG TIME')
      .setDescription(text)
      .addFields({ name: '⏱ Tổng', value: formatTime(total) });

    return i.reply({ embeds: [embed], ephemeral: true });
  }
});

// ===== THÊM GIỜ BẰNG TEXT =====
client.on('messageCreate', async (msg) => {
  if (!msg.mentions.users.size) return;
  if (!hasPermission(msg.member)) return;

  const args = msg.content.split(' ');
  if (args.length < 2) return;

  const user = msg.mentions.users.first();
  const hours = parseFloat(args[1]);

  if (isNaN(hours) || hours <= 0) {
    return msg.reply("❌ Nhập số giờ hợp lệ. Ví dụ: @user 3");
  }

  const endTime = Date.now();
  const startTime = endTime - (hours * 60 * 60 * 1000);

  const duration = calcDurationWithNightBonus(startTime, endTime);

  db.prepare(`
    INSERT INTO shifts (user_id, type, start_time, end_time, duration)
    VALUES (?, 'lspd', ?, ?, ?)
  `).run(user.id, startTime, endTime, duration);

  msg.reply(`✅ Đã thêm ${hours} giờ cho ${user.username}`);
});

// ===== XỬ LÝ ẢNH =====
client.on('messageCreate', async (msg) => {
  const pending = db.prepare(`SELECT * FROM pending WHERE user_id=?`).get(msg.author.id);
  if (!pending) return;

  const now = Date.now();

  if (pending.action === 'start') {

    db.prepare(`
      INSERT INTO shifts (user_id, type, start_time)
      VALUES (?, ?, ?)
    `).run(msg.author.id, pending.type, now);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('🟢 VÀO CA')
      .addFields(
        { name: '👤 Nhân sự', value: msg.author.username },
        { name: '🕒 Thời gian', value: formatDate(now) }
      );

    msg.channel.send({ embeds: [embed] });
  }

  else if (pending.action === 'end') {

    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(msg.author.id);

    if (!row) {
      db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);
      return msg.reply('❌ Bạn chưa vào ca');
    }

    const endTime = Date.now();
    const duration = calcDurationWithNightBonus(row.start_time, endTime);

    db.prepare(`
      UPDATE shifts SET end_time=?, duration=? WHERE id=?
    `).run(endTime, duration, row.id);

    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('🔴 KẾT THÚC CA')
      .addFields(
        { name: '👤 Nhân sự', value: msg.author.username },
        { name: '🕒 Vào', value: formatDate(row.start_time) },
        { name: '🕒 Ra', value: formatDate(endTime) },
        { name: '⏱ Thời gian', value: formatTime(duration) }
      );

    msg.channel.send({ embeds: [embed] });
  }
});

// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot running'));
app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(TOKEN);