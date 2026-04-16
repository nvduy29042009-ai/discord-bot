const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('better-sqlite3');

const TOKEN = process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const db = new Database('data.db');

// ===== TẠO BẢNG =====
db.prepare(`CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER,
  start_img TEXT,
  end_img TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  game_id TEXT,
  role TEXT,
  rate INTEGER
)`).run();

// ===== FORMAT TIME =====
function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} giờ ${m} phút`;
}

client.on('ready', () => {
  console.log('✅ Bot đã sẵn sàng');
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // ===== ĐĂNG KÝ =====
  if (msg.content.startsWith('/dangky')) {
    const args = msg.content.split('|');

    if (args.length < 3) {
      return msg.reply('/dangky id | chucvu | sotien');
    }

    const gameId = args[0].replace('/dangky', '').trim();
    const role = args[1].trim();
    const rate = parseInt(args[2]);

    db.prepare(`INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?)`)
      .run(msg.author.id, gameId, role, rate);

    msg.reply('✅ Đăng ký thành công');
  }

  // ===== VÀO CA =====
  if (msg.content === '/vaocatruc') {
    if (msg.attachments.size === 0) {
      return msg.reply('❌ Phải gửi ảnh');
    }

    const row = db.prepare(`SELECT * FROM shifts WHERE user_id = ? AND end_time IS NULL`)
      .get(msg.author.id);

    if (row) return msg.reply('⚠️ Đang trong ca');

    const img = msg.attachments.first().url;
    const now = new Date();

    db.prepare(`INSERT INTO shifts (user_id, start_time, start_img) VALUES (?, ?, ?)`)
      .run(msg.author.id, Date.now(), img);

    msg.reply(`🟢 Vào ca\n${now.toLocaleString('vi-VN')}`);
  }

  // ===== KẾT THÚC =====
  if (msg.content === '/ketthucca') {
    if (msg.attachments.size === 0) {
      return msg.reply('❌ Phải gửi ảnh');
    }

    const row = db.prepare(`SELECT * FROM shifts WHERE user_id = ? AND end_time IS NULL`)
      .get(msg.author.id);

    if (!row) return msg.reply('❌ Chưa vào ca');

    const end = Date.now();
    const duration = end - row.start_time;

    db.prepare(`UPDATE shifts SET end_time = ?, duration = ?, end_img = ? WHERE id = ?`)
      .run(end, duration, msg.attachments.first().url, row.id);

    msg.reply(`⏱️ ${formatTime(duration)}`);
  }

  // ===== TỔNG =====
  if (msg.content === '/tongcatruc') {
    const rows = db.prepare(`
      SELECT shifts.user_id, SUM(duration) as total, users.rate
      FROM shifts
      LEFT JOIN users ON shifts.user_id = users.user_id
      GROUP BY shifts.user_id
    `).all();

    let text = '📊 Tổng:\n';

    for (const r of rows) {
      const member = await msg.guild.members.fetch(r.user_id);
      const money = Math.floor((r.total / 3600000) * (r.rate || 0));

      text += `${member.user.username}: ${formatTime(r.total)} - ${money}đ\n`;
    }

    msg.reply(text);
  }

  // ===== LÀM MỚI =====
  if (msg.content === '/lammoi') {
    db.prepare(`DELETE FROM shifts`).run();
    msg.reply('🧹 Đã làm mới');
  }
});

client.login(TOKEN);