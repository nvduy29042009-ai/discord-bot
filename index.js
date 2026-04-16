const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();

const TOKEN = process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const db = new sqlite3.Database('./data.db');
const pending = {};

// ===== DATABASE =====
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    start_time INTEGER,
    end_time INTEGER,
    duration INTEGER,
    start_img TEXT,
    end_img TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    game_id TEXT,
    role TEXT,
    rate INTEGER
  )`);
});

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h} giờ ${min} phút`;
}

// ===== READY =====
client.on('ready', () => {
  console.log("🚀 Bot chạy OK");
});

// ===== MENU =====
client.on('messageCreate', async (msg) => {
  if (msg.content === '/menu') {

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('start')
        .setLabel('🟢 Vào ca')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('end')
        .setLabel('🔴 Kết thúc')
        .setStyle(ButtonStyle.Danger)
    );

    msg.reply({
      content: '📌 Bấm nút:',
      components: [row]
    });
  }
});

// ===== BUTTON =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  if (interaction.customId === 'start') {
    pending[userId] = 'start';
    interaction.reply({ content: '📸 Gửi ảnh để vào ca!', ephemeral: true });
  }

  if (interaction.customId === 'end') {
    pending[userId] = 'end';
    interaction.reply({ content: '📸 Gửi ảnh để kết thúc!', ephemeral: true });
  }
});

// ===== MESSAGE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const userId = msg.author.id;

  // ===== ĐĂNG KÝ =====
  if (msg.content.startsWith('/dangky')) {

    const args = msg.content.split('|');

    if (args.length < 3) {
      return msg.reply(`/dangky id | chucvu | tien`);
    }

    const gameId = args[0].replace('/dangky', '').trim();
    const role = args[1].trim();
    const rate = parseInt(args[2]);

    db.run(`INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?)`,
      [userId, gameId, role, rate]);

    return msg.reply('✅ Đăng ký xong');
  }

  // ===== XỬ LÝ ẢNH =====
  if (pending[userId]) {

    if (msg.attachments.size === 0) {
      return msg.reply('❌ Gửi ảnh!');
    }

    const img = msg.attachments.first().url;

    // 👉 XÓA TIN NHẮN NGƯỜI DÙNG
    await msg.delete().catch(() => {});

    // ===== START =====
    if (pending[userId] === 'start') {

      db.get(`SELECT * FROM shifts WHERE user_id = ? AND end_time IS NULL`,
        [userId],
        (err, row) => {

          if (row) {
            delete pending[userId];
            return msg.channel.send('⚠️ Đang trong ca!');
          }

          const now = new Date();

          db.run(`INSERT INTO shifts (user_id, start_time, start_img) VALUES (?, ?, ?)`,
            [userId, Date.now(), img]);

          msg.channel.send(`🟢 VÀO CA

👤 ${msg.author.username}
🕒 ${now.toLocaleString('vi-VN')}
📸 ${img}`);

          delete pending[userId];
        });
    }

    // ===== END =====
    if (pending[userId] === 'end') {

      db.get(`SELECT * FROM shifts WHERE user_id = ? AND end_time IS NULL`,
        [userId],
        (err, row) => {

          if (!row) {
            delete pending[userId];
            return msg.channel.send('❌ Chưa vào ca!');
          }

          const end = Date.now();
          const duration = end - row.start_time;

          const startDate = new Date(row.start_time);
          const endDate = new Date();

          db.run(`UPDATE shifts SET end_time = ?, duration = ?, end_img = ? WHERE id = ?`,
            [end, duration, img, row.id]);

          msg.channel.send(`🔴 KẾT THÚC

👤 ${msg.author.username}
🕒 ${startDate.toLocaleString('vi-VN')} → ${endDate.toLocaleString('vi-VN')}
⏱️ ${formatTime(duration)}

📸 ${img}`);

          delete pending[userId];
        });
    }

    return;
  }

  // ===== TỔNG =====
  if (msg.content === '/tongcatruc') {

    db.all(`
      SELECT shifts.user_id, SUM(shifts.duration) as total, users.rate 
      FROM shifts 
      LEFT JOIN users ON shifts.user_id = users.user_id
      GROUP BY shifts.user_id
    `, async (err, rows) => {

      let text = "📊 BẢNG TỔNG:\n\n";

      for (const r of rows) {
        const member = await msg.guild.members.fetch(r.user_id);

        const hours = (r.total || 0) / 1000 / 3600;
        const money = Math.floor(hours * (r.rate || 0));

        text += `👤 ${member.user.username}
⏱️ ${formatTime(r.total || 0)}
💰 ${money.toLocaleString()} VND\n\n`;
      }

      msg.reply(text);
    });
  }

  // ===== RESET =====
  if (msg.content === '/lammoi') {

    if (!msg.member.permissions.has('Administrator')) {
      return msg.reply('❌ Admin only');
    }

    db.run(`DELETE FROM shifts`);
    msg.reply('🧹 Đã reset');
  }

});

client.login(TOKEN);