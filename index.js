const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

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
const pending = {};

// ===== DATABASE =====
db.prepare(`CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  type TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER,
  start_img TEXT,
  end_img TEXT
)`).run();

// ===== FORMAT =====
function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}p`;
}

// ===== READY =====
client.on('ready', () => {
  console.log('✅ BOT PRO MAX đa khu đã chạy');
});

// ===== PANEL =====
client.on('messageCreate', async (msg) => {
  if (msg.content === '/panel') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('benhvien')
        .setLabel('🏥 Vào ca Bệnh viện')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('lspd')
        .setLabel('🚓 Vào ca LSPD')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('end')
        .setLabel('🔴 Kết thúc ca')
        .setStyle(ButtonStyle.Danger)
    );

    msg.channel.send({
      content: '📋 BẢNG CHẤM CÔNG',
      components: [row]
    });
  }
});

// ===== CLICK BUTTON =====
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  const id = i.user.id;

  if (i.customId === 'benhvien') {
    pending[id] = { type: 'benhvien', action: 'start' };
    return i.reply('📸 Gửi ảnh vào ca Bệnh viện');
  }

  if (i.customId === 'lspd') {
    pending[id] = { type: 'lspd', action: 'start' };
    return i.reply('📸 Gửi ảnh vào ca LSPD');
  }

  if (i.customId === 'end') {
    pending[id] = { action: 'end' };
    return i.reply('📸 Gửi ảnh kết thúc ca');
  }
});

// ===== NHẬN ẢNH =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const id = msg.author.id;
  if (!pending[id]) return;
  if (msg.attachments.size === 0) return;

  const img = msg.attachments.first().url;

  // ===== VÀO CA =====
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

    await msg.delete();

    msg.channel.send(`🟢 ${msg.author.username} vào ca ${pending[id].type.toUpperCase()}`);
  }

  // ===== KẾT THÚC =====
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

    await msg.delete();

    msg.channel.send(`🔴 ${msg.author.username} kết thúc ca (${row.type}) - ${formatTime(duration)}`);
  }

  delete pending[id];
});

// ===== TỔNG =====
client.on('messageCreate', async (msg) => {
  if (msg.content === '/tong') {
    const rows = db.prepare(`
      SELECT user_id, type, SUM(duration) as total
      FROM shifts
      GROUP BY user_id, type
    `).all();

    let text = '📊 TỔNG CA:\n\n';

    for (const r of rows) {
      const member = await msg.guild.members.fetch(r.user_id);
      text += `${member.user.username} | ${r.type} | ${formatTime(r.total)}\n`;
    }

    msg.reply(text);
  }
});

client.login(TOKEN);