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

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  rate INTEGER
)
`).run();

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} giờ ${mm} phút`;
}

// ===== CA ĐÊM X2 =====
function calcSalary(duration, startTime, rate) {
  const hour = new Date(startTime).getHours();
  let money = (duration / 3600000) * rate;

  if (hour >= 23 || hour < 6) {
    money *= 2;
  }

  return Math.floor(money);
}

// ===== READY =====
client.on('ready', () => {
  console.log('🔥 BOT FULL PRO MAX chạy');
});

// ===== MENU =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === '.menu') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('benhvien').setLabel('🏥 Bệnh viện').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('lspd').setLabel('🚓 LSPD').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 Kết thúc').setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tong').setLabel('📊 Tổng + lương').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('register').setLabel('💰 Đăng ký lương').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('reset').setLabel('🧹 Reset').setStyle(ButtonStyle.Danger)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lspd_list').setLabel('📋 LSPD đang trực').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('bv_list').setLabel('🏥 BV đang trực').setStyle(ButtonStyle.Secondary)
    );

    return msg.channel.send({
      content: '📋 BẢNG CHẤM CÔNG PRO MAX',
      components: [row1, row2, row3]
    });
  }

  const id = msg.author.id;

  // ===== NHẬP LƯƠNG =====
  if (pending[id]?.action === 'setrate') {
    const rate = parseInt(msg.content);
    if (!rate) return msg.reply('❌ Nhập số hợp lệ');

    db.prepare(`INSERT OR REPLACE INTO users VALUES (?, ?)`)
      .run(id, rate);

    delete pending[id];
    return msg.reply(`💰 Lương của bạn: ${rate}/giờ`);
  }

  // ===== NHẬN ẢNH =====
  if (!pending[id]) return;
  if (msg.attachments.size === 0) return;

  const img = msg.attachments.first().url;

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

    await msg.delete().catch(() => {});
    msg.channel.send(`🟢 ${msg.author.username} vào ca ${pending[id].type.toUpperCase()}`);
  }

  // ===== END =====
  if (pending[id].action === 'end') {
    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(id);

    if (!row) {
      delete pending[id];
      return msg.reply('❌ Bạn chưa vào ca');
    }

    const end = Date.now();
    const duration = end - row.start_time;

    db.prepare(`
      UPDATE shifts SET end_time=?, duration=?, end_img=? WHERE id=?
    `).run(end, duration, img, row.id);

    const user = db.prepare(`SELECT * FROM users WHERE user_id=?`).get(id);
    const rate = user?.rate || 0;

    const money = calcSalary(duration, row.start_time, rate);

    await msg.delete().catch(() => {});
    msg.channel.send(`🔴 ${msg.author.username} kết thúc (${row.type})
⏱ ${formatTime(duration)}
💰 ${money}`);
  }

  delete pending[id];
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

  if (i.customId === 'register') {
    pending[id] = { action: 'setrate' };
    return i.reply({ content: '💰 Nhập lương (vd: 8000)', ephemeral: true });
  }

  if (i.customId === 'tong') {
    const rows = db.prepare(`
      SELECT user_id, type, SUM(duration) as total
      FROM shifts
      GROUP BY user_id, type
    `).all();

    const users = {};

    for (const r of rows) {
      if (!users[r.user_id]) users[r.user_id] = { benhvien: 0, lspd: 0 };
      users[r.user_id][r.type] = r.total;
    }

    let text = '📊 TỔNG:\n\n';

    for (const userId in users) {
      let name = 'Unknown';

      try {
        const member = await i.guild.members.fetch(userId);
        name = member.user.username;
      } catch {}

      const user = db.prepare(`SELECT * FROM users WHERE user_id=?`).get(userId);
      const rate = user?.rate || 0;

      const bv = users[userId].benhvien;
      const lspd = users[userId].lspd;

      const moneyBV = calcSalary(bv, Date.now(), rate);
      const moneyLSPD = calcSalary(lspd, Date.now(), rate);

      text += `👤 ${name}
🏥 BV: ${formatTime(bv)} | 💰 ${moneyBV}
🚓 LSPD: ${formatTime(lspd)} | 💰 ${moneyLSPD}

`;
    }

    return i.reply({ content: text, ephemeral: true });
  }

  if (i.customId === 'lspd_list') {
    const rows = db.prepare(`
      SELECT * FROM shifts WHERE type='lspd' AND end_time IS NULL
    `).all();

    if (!rows.length) return i.reply({ content: '🚓 Không ai trực', ephemeral: true });

    let text = '🚓 LSPD:\n';

    for (const r of rows) {
      const member = await i.guild.members.fetch(r.user_id);
      const time = Date.now() - r.start_time;
      text += `${member.user.username} - ${formatTime(time)}\n`;
    }

    return i.reply({ content: text, ephemeral: true });
  }

  if (i.customId === 'bv_list') {
    const rows = db.prepare(`
      SELECT * FROM shifts WHERE type='benhvien' AND end_time IS NULL
    `).all();

    if (!rows.length) return i.reply({ content: '🏥 Không ai trực', ephemeral: true });

    let text = '🏥 BV:\n';

    for (const r of rows) {
      const member = await i.guild.members.fetch(r.user_id);
      const time = Date.now() - r.start_time;
      text += `${member.user.username} - ${formatTime(time)}\n`;
    }

    return i.reply({ content: text, ephemeral: true });
  }

  if (i.customId === 'reset') {
    if (!i.member.permissions.has('Administrator')) {
      return i.reply({ content: '❌ Không có quyền', ephemeral: true });
    }

    db.prepare(`DELETE FROM shifts`).run();
    return i.reply('🧹 Đã reset');
  }
});

// ===== FIX RENDER (BẮT BUỘC) =====
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server chạy cổng ${PORT}`);
});

// ===== LOGIN =====
client.login(TOKEN);