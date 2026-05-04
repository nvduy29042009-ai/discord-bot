<<<<<<< HEAD
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
const ExcelJS = require('exceljs');

const TOKEN = process.env.TOKEN;

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

// ===== CONFIG =====
const IMPOUND_CHANNEL_ID = '1492541035530686596';
const REPORT_CHANNEL_ID = '1489474172039204914';

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

// ===== TIME =====
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
db.prepare(`CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS pending (
  user_id TEXT PRIMARY KEY,
  action TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS impounds (
  user_id TEXT PRIMARY KEY,
  count INTEGER
)`).run();

// ===== STATUS =====
function updateBotStatus() {
  if (!client.user) return;

  const count = getOnDutyCount();

  client.user.setActivity({
    name: `LSPD GTAGO | ${count} PD ĐANG TRỰC`,
    type: 3
  });
}

// ===== MENU =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === '!menu') {
    await msg.delete().catch(() => {});
    if (menuMessage) await menuMessage.delete().catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('📋 BẢNG CHẤM CÔNG')
      .setColor('Blue')
      .addFields({ name: '👮 On Duty', value: `${getOnDutyCount()} người` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start').setLabel('🟢 VÀO CA').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 KẾT THÚC').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tong').setLabel('📊 TỔNG').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('excel').setLabel('📁 EXCEL').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('reset').setLabel('🔁 RESET CA').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_impound').setLabel('🚓 RESET XE').setStyle(ButtonStyle.Danger)
    );

    menuMessage = await msg.channel.send({ embeds: [embed], components: [row] });
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

  if (i.customId === 'tong') {
    const rows = db.prepare(`SELECT user_id, SUM(duration) as total FROM shifts GROUP BY user_id`).all();

    let text = '';

    for (const r of rows) {
      const imp = db.prepare(`SELECT count FROM impounds WHERE user_id=?`).get(r.user_id);
      text += `<@${r.user_id}>: ${formatTime(r.total || 0)} | 🚓 ${imp ? imp.count : 0}\n`;
    }

    return i.reply({
      embeds: [new EmbedBuilder().setTitle('📊 TỔNG CHUNG').setDescription(text || 'Không có dữ liệu')]
    });
  }

  // ADMIN
  if (i.customId === 'excel') {
    if (!hasPermission(i.member)) return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    await exportExcel();
    return i.reply({ content: "📊 Đã xuất Excel", ephemeral: true });
  }

  if (i.customId === 'reset') {
    if (!hasPermission(i.member)) return i.reply({ content: "❌ Không có quyền", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_reset_ca').setLabel('✅ XÁC NHẬN').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel').setLabel('❌ HỦY').setStyle(ButtonStyle.Secondary)
    );

    return i.reply({ content: '⚠️ Reset chấm công?', components: [row], ephemeral: true });
  }

  if (i.customId === 'confirm_reset_ca') {
    db.prepare(`DELETE FROM shifts`).run();
    return i.update({ content: '✅ Đã reset ca', components: [] });
  }

  if (i.customId === 'reset_impound') {
    if (!hasPermission(i.member)) return i.reply({ content: "❌ Không có quyền", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_reset_xe').setLabel('✅ XÁC NHẬN').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel').setLabel('❌ HỦY').setStyle(ButtonStyle.Secondary)
    );

    return i.reply({ content: '⚠️ Reset giam xe?', components: [row], ephemeral: true });
  }

  if (i.customId === 'confirm_reset_xe') {
    db.prepare(`DELETE FROM impounds`).run();
    return i.update({ content: '🚓 Đã reset xe', components: [] });
  }

  if (i.customId === 'cancel') {
    return i.update({ content: '❌ Đã hủy', components: [] });
  }
});

// ===== !TONGXE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.content !== '!tongxe') return;

  const rows = db.prepare(`SELECT * FROM impounds`).all();

  let text = '';
  for (const r of rows) {
    text += `<@${r.user_id}>: 🚓 ${r.count}\n`;
  }

  msg.channel.send({
    embeds: [new EmbedBuilder().setTitle('🚓 TỔNG GIAM XE').setDescription(text || 'Không có dữ liệu')]
  });
});

// ===== GIAM XE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== IMPOUND_CHANNEL_ID) return;
  if (!msg.attachments.size) return;

  const row = db.prepare(`SELECT * FROM impounds WHERE user_id=?`).get(msg.author.id);

  let count = 1;
  if (row) {
    count = row.count + 1;
    db.prepare(`UPDATE impounds SET count=? WHERE user_id=?`).run(count, msg.author.id);
  } else {
    db.prepare(`INSERT INTO impounds VALUES (?, ?)`).run(msg.author.id, 1);
  }

  msg.react('🚓');
  msg.reply(`🚓 Bạn đã giam tổng cộng **${count} xe**`);
});

// ===== HANDLE CA =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const pending = db.prepare(`SELECT * FROM pending WHERE user_id=?`).get(msg.author.id);
  if (!pending) return;

  const now = Date.now();
  const attachment = msg.attachments.first();

  if (pending.action === 'start') {
    db.prepare(`INSERT INTO shifts (user_id, start_time) VALUES (?, ?)`).run(msg.author.id, now);
    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    msg.channel.send({
      embeds: [new EmbedBuilder()
        .setColor('Green')
        .setTitle('🟢 VÀO CA')
        .setThumbnail(msg.author.displayAvatarURL())
        .addFields(
          { name: '👤 Nhân sự', value: msg.author.username },
          { name: '🕒 Thời gian', value: getVNTime(now) }
        )
        .setImage(attachment?.url || null)]
    });

    updateBotStatus();
  }

  if (pending.action === 'end') {
    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(msg.author.id);
    if (!row) return msg.reply('❌ CHƯA VÀO CA');

    const end = now;
    const duration = calcDurationWithNightBonus(row.start_time, end);

    db.prepare(`UPDATE shifts SET end_time=?, duration=? WHERE id=?`).run(end, duration, row.id);
    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    msg.channel.send({
      embeds: [new EmbedBuilder()
        .setColor('Red')
        .setTitle('🔴 KẾT THÚC CA')
        .setThumbnail(msg.author.displayAvatarURL())
        .addFields(
          { name: '👤 Nhân sự', value: msg.author.username },
          { name: '🕒 Vào', value: getVNTime(row.start_time) },
          { name: '🕒 Ra', value: getVNTime(end) },
          { name: '⏱ Thời gian', value: formatTime(duration) }
        )
        .setImage(attachment?.url || null)]
    });

    updateBotStatus();
  }
});

// ===== EXPORT (HIỂN TÊN) =====
async function exportExcel() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ChamCong');

  sheet.columns = [
    { header: 'User', key: 'user' },
    { header: 'Time', key: 'time' },
    { header: 'Xe', key: 'xe' }
  ];

  const rows = db.prepare(`SELECT user_id, SUM(duration) as total FROM shifts GROUP BY user_id`).all();

  for (const r of rows) {
    const imp = db.prepare(`SELECT count FROM impounds WHERE user_id=?`).get(r.user_id);

    let username = r.user_id;
    try {
      const userObj = await client.users.fetch(r.user_id);
      if (userObj) username = userObj.username;
    } catch {}

    sheet.addRow({
      user: username,
      time: formatTime(r.total || 0),
      xe: imp ? imp.count : 0
    });
  }

  await workbook.xlsx.writeFile('chamcong.xlsx');

  const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
  channel.send({ files: ['chamcong.xlsx'] });
}

// ===== AUTO 0H =====
function scheduleDailyExport() {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));

  const next = new Date(vnNow);
  next.setHours(24, 0, 0, 0);

  setTimeout(() => {
    exportExcel();
    setInterval(exportExcel, 86400000);
  }, next - vnNow);
}

// ===== READY =====
client.once('ready', () => {
  console.log('READY');
  updateBotStatus();
  scheduleDailyExport();
});

// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.listen(3000);

=======
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
const ExcelJS = require('exceljs');

const TOKEN = process.env.TOKEN;

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

// ===== CONFIG =====
const IMPOUND_CHANNEL_ID = '1492541035530686596';
const REPORT_CHANNEL_ID = '1489474172039204914';

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

// ===== TIME =====
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
db.prepare(`CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS pending (
  user_id TEXT PRIMARY KEY,
  action TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS impounds (
  user_id TEXT PRIMARY KEY,
  count INTEGER
)`).run();

// ===== STATUS =====
function updateBotStatus() {
  if (!client.user) return;

  const count = getOnDutyCount();

  client.user.setActivity({
    name: `LSPD GTAGO | ${count} PD ĐANG TRỰC`,
    type: 3
  });
}

// ===== MENU =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === '!menu') {
    await msg.delete().catch(() => {});
    if (menuMessage) await menuMessage.delete().catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('📋 BẢNG CHẤM CÔNG')
      .setColor('Blue')
      .addFields({ name: '👮 On Duty', value: `${getOnDutyCount()} người` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start').setLabel('🟢 VÀO CA').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end').setLabel('🔴 KẾT THÚC').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tong').setLabel('📊 TỔNG').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('excel').setLabel('📁 EXCEL').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('reset').setLabel('🔁 RESET CA').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_impound').setLabel('🚓 RESET XE').setStyle(ButtonStyle.Danger)
    );

    menuMessage = await msg.channel.send({ embeds: [embed], components: [row] });
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

  if (i.customId === 'tong') {
    const rows = db.prepare(`SELECT user_id, SUM(duration) as total FROM shifts GROUP BY user_id`).all();

    let text = '';

    for (const r of rows) {
      const imp = db.prepare(`SELECT count FROM impounds WHERE user_id=?`).get(r.user_id);
      text += `<@${r.user_id}>: ${formatTime(r.total || 0)} | 🚓 ${imp ? imp.count : 0}\n`;
    }

    return i.reply({
      embeds: [new EmbedBuilder().setTitle('📊 TỔNG CHUNG').setDescription(text || 'Không có dữ liệu')]
    });
  }

  // ADMIN
  if (i.customId === 'excel') {
    if (!hasPermission(i.member)) return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    await exportExcel();
    return i.reply({ content: "📊 Đã xuất Excel", ephemeral: true });
  }

  if (i.customId === 'reset') {
    if (!hasPermission(i.member)) return i.reply({ content: "❌ Không có quyền", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_reset_ca').setLabel('✅ XÁC NHẬN').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel').setLabel('❌ HỦY').setStyle(ButtonStyle.Secondary)
    );

    return i.reply({ content: '⚠️ Reset chấm công?', components: [row], ephemeral: true });
  }

  if (i.customId === 'confirm_reset_ca') {
    db.prepare(`DELETE FROM shifts`).run();
    return i.update({ content: '✅ Đã reset ca', components: [] });
  }

  if (i.customId === 'reset_impound') {
    if (!hasPermission(i.member)) return i.reply({ content: "❌ Không có quyền", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_reset_xe').setLabel('✅ XÁC NHẬN').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel').setLabel('❌ HỦY').setStyle(ButtonStyle.Secondary)
    );

    return i.reply({ content: '⚠️ Reset giam xe?', components: [row], ephemeral: true });
  }

  if (i.customId === 'confirm_reset_xe') {
    db.prepare(`DELETE FROM impounds`).run();
    return i.update({ content: '🚓 Đã reset xe', components: [] });
  }

  if (i.customId === 'cancel') {
    return i.update({ content: '❌ Đã hủy', components: [] });
  }
});

// ===== !TONGXE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.content !== '!tongxe') return;

  const rows = db.prepare(`SELECT * FROM impounds`).all();

  let text = '';
  for (const r of rows) {
    text += `<@${r.user_id}>: 🚓 ${r.count}\n`;
  }

  msg.channel.send({
    embeds: [new EmbedBuilder().setTitle('🚓 TỔNG GIAM XE').setDescription(text || 'Không có dữ liệu')]
  });
});

// ===== GIAM XE =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== IMPOUND_CHANNEL_ID) return;
  if (!msg.attachments.size) return;

  const row = db.prepare(`SELECT * FROM impounds WHERE user_id=?`).get(msg.author.id);

  let count = 1;
  if (row) {
    count = row.count + 1;
    db.prepare(`UPDATE impounds SET count=? WHERE user_id=?`).run(count, msg.author.id);
  } else {
    db.prepare(`INSERT INTO impounds VALUES (?, ?)`).run(msg.author.id, 1);
  }

  msg.react('🚓');
  msg.reply(`🚓 Bạn đã giam tổng cộng **${count} xe**`);
});

// ===== HANDLE CA =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const pending = db.prepare(`SELECT * FROM pending WHERE user_id=?`).get(msg.author.id);
  if (!pending) return;

  const now = Date.now();
  const attachment = msg.attachments.first();

  if (pending.action === 'start') {
    db.prepare(`INSERT INTO shifts (user_id, start_time) VALUES (?, ?)`).run(msg.author.id, now);
    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    msg.channel.send({
      embeds: [new EmbedBuilder()
        .setColor('Green')
        .setTitle('🟢 VÀO CA')
        .setThumbnail(msg.author.displayAvatarURL())
        .addFields(
          { name: '👤 Nhân sự', value: msg.author.username },
          { name: '🕒 Thời gian', value: getVNTime(now) }
        )
        .setImage(attachment?.url || null)]
    });

    updateBotStatus();
  }

  if (pending.action === 'end') {
    const row = db.prepare(`SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL`).get(msg.author.id);
    if (!row) return msg.reply('❌ CHƯA VÀO CA');

    const end = now;
    const duration = calcDurationWithNightBonus(row.start_time, end);

    db.prepare(`UPDATE shifts SET end_time=?, duration=? WHERE id=?`).run(end, duration, row.id);
    db.prepare(`DELETE FROM pending WHERE user_id=?`).run(msg.author.id);

    msg.channel.send({
      embeds: [new EmbedBuilder()
        .setColor('Red')
        .setTitle('🔴 KẾT THÚC CA')
        .setThumbnail(msg.author.displayAvatarURL())
        .addFields(
          { name: '👤 Nhân sự', value: msg.author.username },
          { name: '🕒 Vào', value: getVNTime(row.start_time) },
          { name: '🕒 Ra', value: getVNTime(end) },
          { name: '⏱ Thời gian', value: formatTime(duration) }
        )
        .setImage(attachment?.url || null)]
    });

    updateBotStatus();
  }
});

// ===== EXPORT (HIỂN TÊN) =====
async function exportExcel() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ChamCong');

  sheet.columns = [
    { header: 'User', key: 'user' },
    { header: 'Time', key: 'time' },
    { header: 'Xe', key: 'xe' }
  ];

  const rows = db.prepare(`SELECT user_id, SUM(duration) as total FROM shifts GROUP BY user_id`).all();

  for (const r of rows) {
    const imp = db.prepare(`SELECT count FROM impounds WHERE user_id=?`).get(r.user_id);

    let username = r.user_id;
    try {
      const userObj = await client.users.fetch(r.user_id);
      if (userObj) username = userObj.username;
    } catch {}

    sheet.addRow({
      user: username,
      time: formatTime(r.total || 0),
      xe: imp ? imp.count : 0
    });
  }

  await workbook.xlsx.writeFile('chamcong.xlsx');

  const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
  channel.send({ files: ['chamcong.xlsx'] });
}

// ===== AUTO 0H =====
function scheduleDailyExport() {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));

  const next = new Date(vnNow);
  next.setHours(24, 0, 0, 0);

  setTimeout(() => {
    exportExcel();
    setInterval(exportExcel, 86400000);
  }, next - vnNow);
}

// ===== READY =====
client.once('ready', () => {
  console.log('READY');
  updateBotStatus();
  scheduleDailyExport();
});

// ===== SERVER =====
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.listen(3000);

>>>>>>> 500d38c5ed932d6c9c951c3bc60a90a54e4ab2a8
client.login(TOKEN);