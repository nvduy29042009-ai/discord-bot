const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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
const pending = {};

// ===== DATABASE =====
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

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} giờ ${mm} phút`;
}

// ===== GIỜ ĐÊM X2 =====
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
client.on('clientReady', () => {
  console.log('🔥 BOT chạy');
});

// ===== MENU + XỬ LÝ ẢNH =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // ===== MENU =====
  if (msg.content.trim() === '.menu') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('benhvien').setLabel('🏥 Bệnh viện').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('lspd').setLabel('🚓 LSPD').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 Kết thúc').setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tong').setLabel('📊 Tổng ONDUTY').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('reset_bv').setLabel('🧹 Reset BV').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_lspd').setLabel('🧹 Reset LSPD').setStyle(ButtonStyle.Danger)
    );

    return msg.channel.send({
      content: '📋 BẢNG CHẤM CÔNG',
      components: [row1, row2]
    });
  }

  const id = msg.author.id;

  // ❗ KHÔNG pending → bỏ qua luôn (không reply)
  if (!pending[id]) return;

  // ❗ KHÔNG có ảnh → nhắc nhẹ
  if (!msg.attachments || msg.attachments.size === 0) {
    return msg.reply('📸 Gửi ảnh để xác nhận');
  }

  // delay chống bug Discord
  await new Promise(r => setTimeout(r, 300));

  const img = msg.attachments.first()?.url;
  if (!img) return msg.reply('❌ Không nhận được ảnh');

  // ===== START =====
  if (pending[id].action === 'start') {
    const check = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (check) {
      delete pending[id];
      return msg.reply('⚠️ Bạn đang trong ca');
    }

    db.prepare(`
      INSERT INTO shifts (user_id, type, start_time, start_img)
      VALUES (?, ?, ?, ?)
    `).run(id, pending[id].type, Date.now(), img);

    msg.channel.send(`🟢 ${msg.author.username} vào ca ${pending[id].type.toUpperCase()}`);

    delete pending[id];
  }

  // ===== END =====
  else if (pending[id].action === 'end') {
    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (!row) {
      delete pending[id];
      return msg.reply('❌ Bạn chưa vào ca');
    }

    const end = Date.now();
    const duration = calcDurationWithNightBonus(row.start_time, end);

    db.prepare(`
      UPDATE shifts SET end_time=?, duration=?, end_img=? WHERE id=?
    `).run(end, duration, img, row.id);

    msg.channel.send(`🔴 ${msg.author.username} kết thúc (${row.type})
⏱ ${formatTime(duration)}`);

    delete pending[id];
  }
});

// ===== BUTTON =====
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  const id = i.user.id;

  if (i.customId === 'benhvien') {
    pending[id] = { type: 'benhvien', action: 'start' };
    return i.reply({ content: '📸 Gửi ảnh vào ca BV', ephemeral: true });
  }

  if (i.customId === 'lspd') {
    pending[id] = { type: 'lspd', action: 'start' };
    return i.reply({ content: '📸 Gửi ảnh vào ca LSPD', ephemeral: true });
  }

  if (i.customId === 'end') {
    pending[id] = { action: 'end' };
    return i.reply({ content: '📸 Gửi ảnh kết thúc', ephemeral: true });
  }

  // ===== TỔNG =====
  if (i.customId === 'tong') {
    const rows = db.prepare(`
      SELECT user_id, type, SUM(duration) as total
      FROM shifts
      GROUP BY user_id, type
    `).all();

    const users = {};

    for (const r of rows) {
      if (!users[r.user_id]) users[r.user_id] = {};
      users[r.user_id][r.type] = r.total;
    }

    let text = '📊 TỔNG ONDUTY:\n\n';

    for (const userId in users) {
      let name = 'Unknown';

      try {
        const member = await i.guild.members.fetch(userId);
        name = member.user.username;
      } catch {}

      text += `👤 ${name}\n`;

      if (users[userId].benhvien) {
        text += `🏥 BV: ${formatTime(users[userId].benhvien)}\n`;
      }

      if (users[userId].lspd) {
        text += `🚓 LSPD: ${formatTime(users[userId].lspd)}\n`;
      }

      text += `\n`;
    }

    return i.reply({ content: text, ephemeral: true });
  }

  if (i.customId === 'reset_bv') {
    db.prepare(`DELETE FROM shifts WHERE type='benhvien'`).run();
    return i.reply('🧹 Đã reset BV');
  }

  if (i.customId === 'reset_lspd') {
    db.prepare(`DELETE FROM shifts WHERE type='lspd'`).run();
    return i.reply('🧹 Đã reset LSPD');
  }
});

// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(TOKEN);