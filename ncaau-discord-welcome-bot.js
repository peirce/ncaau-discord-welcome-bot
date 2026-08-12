
// ncaau-discord-welcome-bot.js
// On join: posts in the Welcome Committee channel, tags the new member + the
// committee member whose turn it is (longest-waiting), and pre-adds ✅ and 🗨.
//   ✅  = a committee member reached out
//   🗨  = the newcomer replied
// Also watches the 👋-introductions channel and posts back in the Welcome Committee channel
// the first time a tracked newcomer posts there.
// Commands: /welcome rotation, /welcome whosup, /welcome greeter skiptoback|skiptofront|snooze|unsnooze @user, /welcome stats
// Note: membership of the Welcome Committee role is managed externally (e.g. Carl-bot reaction roles);
// this bot only reads the role, never adds/removes it.
// Also auto-posts a weekly summary to the channel.
//
// Requires:
//    Node.js 22.12+
//      npm install discord.js
// Run via command... node --env-file=.env ncaau-discord-welcome-bot.js
// The .env file contains DISCORD_TOKEN, GUILD_ID, CHANNEL_ID, ROLE_ID, INTRO_CHANNEL_ID.

const fs = require('node:fs');
const {
  Client, GatewayIntentBits, Events, Partials, SlashCommandBuilder,
} = require('discord.js');

// ---------------- CONFIG ----------------
const TOKEN       = process.env.DISCORD_TOKEN;  // From .env file
const GUILD_ID    = process.env.GUILD_ID;    // NCAAU Discord SERVER id
const CHANNEL_ID  = process.env.CHANNEL_ID;  // 👋-welcome-committee CHANNEL id
const ROLE_ID     = process.env.ROLE_ID;     // Welcome Committee ROLE id
const INTRO_ID    = process.env.INTRO_CHANNEL_ID; // 👋-introductions CHANNEL id (optional — blank turns the watch off)
const STATE_FILE  = './welcome-data.json';
const WEEKLY_DAY  = 1;  // Weekly summary day: 0=Sun, 1=Mon ... 6=Sat
const WEEKLY_HOUR = 9;  // Weekly summary hour (24h), in the HOST machine's local time
const INTRO_DAYS  = 30; // Only announce an intro post from someone who joined within this many days
// ----------------------------------------

for (const [name, value] of Object.entries({ DISCORD_TOKEN: TOKEN, GUILD_ID, CHANNEL_ID, ROLE_ID })) {
  if (!value) {
    console.error(`ERROR: ${name} is missing from .env`);
    process.exit(1);
  }
}

const REACHED_OUT = '✅'; // U+2705
const REPLIED     = '🗨'; // U+1F5E8 (FE0F variation selector stripped)
const normalizeEmoji = (name) => (name ? name.replace(/\uFE0F/g, '') : name);

// ---- persistent state ----
let data = { rotation: {}, welcomes: {}, snoozed: {}, lastWeekly: '' };
try {
  const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  data = {
    rotation: loaded.rotation ?? {},
    welcomes: loaded.welcomes ?? {},
    snoozed: loaded.snoozed ?? {},
    lastWeekly: loaded.lastWeekly ?? '',
  };
  // Older state files called this onDutyId. Carry it over so past welcomes keep their greeter.
  for (const rec of Object.values(data.welcomes)) {
    if (rec.greeterId === undefined && 'onDutyId' in rec) {
      rec.greeterId = rec.onDutyId;
      delete rec.onDutyId;
    }
  }
} catch {
  // First run is unreadable. Start fresh.
}
function saveData() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Could not save state:', e);
  }
}

function isSnoozed(userId) {
  const until = data.snoozed[userId];
  return !!until && new Date().toISOString().slice(0, 10) < until;
}

// rotation order: longest-waiting first (never-assigned counts as 0); snoozed members excluded
function rotationOrder(committee) {
  return [...committee.values()]
    .filter((m) => !isSnoozed(m.id))
    .sort((a, b) => {
      const ta = data.rotation[a.id] ?? 0;
      const tb = data.rotation[b.id] ?? 0;
      return ta !== tb ? ta - tb : a.id.localeCompare(b.id);
    });
}

// shared stats text for /stats and the weekly post
function buildStatsText(days, title) {
  const cutoff = Date.now() - days * 86400000;
  const records = Object.values(data.welcomes).filter((r) => r.joinedAt >= cutoff);
  const joins = records.length;
  if (joins === 0) return `${title}\nNo joins recorded in the last ${days} day${days === 1 ? '' : 's'}.`;
  const reached = records.filter((r) => r.reachedOut).length;
  const replied = records.filter((r) => r.replied).length;
  const intros  = records.filter((r) => r.introPostedAt).length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const lines = [
    title,
    `New joins: ${joins}`,
    `✅ Reached out: ${reached} (${pct(reached, joins)}% of joins)`,
    `🗨 Replied: ${replied} (${pct(replied, joins)}% of joins · ${pct(replied, reached)}% of those contacted)`,
  ];
  // Counted by the bot itself, not from reactions — so it's only shown when the watch is on.
  if (INTRO_ID) lines.push(`📝 Posted an intro: ${intros} (${pct(intros, joins)}% of joins)`);
  return lines.join('\n');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,          // privileged — toggle ON in the Dev Portal
    GatewayIntentBits.GuildMessageReactions, // standard — no portal toggle
    GatewayIntentBits.GuildMessages,         // standard — needed to see posts in 👋-introductions
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User], // catch reactions on uncached msgs
});

// ---- slash command definitions ----
const welcomeCommand = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Welcome Committee tools.')
  .addSubcommandGroup((group) =>
    group.setName('greeter')
      .setDescription('Manage Welcome Committee rotation and availability.')
      .addSubcommand((sub) =>
        sub.setName('snooze')
          .setDescription('Pauses someone from the rotation until DATE (YYYY-MM-DD).')
          .addUserOption((opt) => opt.setName('user').setDescription('Member to snooze.').setRequired(true))
          .addStringOption((opt) => opt.setName('until').setDescription('Return date (YYYY-MM-DD).').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('unsnooze')
          .setDescription('Cancels the snooze early: Returns someone to the rotation.')
          .addUserOption((opt) => opt.setName('user').setDescription('Member to unsnooze.').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('skiptoback')
          .setDescription('Moves them to the back of the rotation queue.')
          .addUserOption((opt) => opt.setName('user').setDescription('Committee member.').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('skiptofront')
          .setDescription('Moves them to the front of the rotation queue.')
          .addUserOption((opt) => opt.setName('user').setDescription('Committee member.').setRequired(true))
      )
  )
  .addSubcommand((sub) =>
    sub.setName('rotation')
      .setDescription('Shows the full rotation queue and any snoozes.')
  )
  .addSubcommand((sub) =>
    sub.setName('whosup')
      .setDescription("Shows who's next in the welcome rotation.")
  )
  .addSubcommand((sub) =>
    sub.setName('stats')
      .setDescription('Shows join count, reach-out rate, reply rate, and intro-post rate for the last 30 days.')
      .addIntegerOption((opt) =>
        opt.setName('days').setDescription('Or for the last now many days? (Default is 30.)').setMinValue(1)
      )
  );

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(GUILD_ID);

    await guild.commands.set([welcomeCommand.toJSON()]);
    console.log('The welcome-bot is on duty. Use /welcome to see a list of commands.');
  } catch (e) {
    console.error('ERROR during startup — check GUILD_ID and bot permissions:', e);
    process.exit(1);
  }
  maybePostWeekly();
  setInterval(maybePostWeekly, 15 * 60 * 1000); // re-check every 15 min
});

// ---- someone joins ----
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  const guild = member.guild;

  const channel = await guild.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('ERROR: Could not identify the Welcome channel — check CHANNEL_ID and permissions.');
    return;
  }

  await guild.members.fetch(); // populate cache so the role filter is complete
  const committee = guild.members.cache.filter((m) => m.roles.cache.has(ROLE_ID) && !m.user.bot);
  const available = rotationOrder(committee); // excludes snoozed members

  if (available.length === 0) {
    const reason = committee.size === 0
      ? 'No one holds the Welcome Committee role right now'
      : 'All Welcome Committee members are currently snoozed';
    data.welcomes[`nc-${member.id}-${Date.now()}`] = {
      memberId: member.id, username: member.user.username,
      joinedAt: Date.now(), greeterId: null, reachedOut: false, replied: false, noCommittee: true,
    };
    saveData();
    await channel.send({
      content: `👋 Welcome <@${member.id}>! (${reason} — someone please say hi.)`,
      allowedMentions: { users: [member.id] },
    }).catch(() => {});
    return;
  }

  const greeter = available[0];
  const msg =
    `<@${greeter.id}>, you're up — please reach out and say hello to <@${member.id}>. 🤝\n` +
    `_React with ${REACHED_OUT} once you've reached out, and ${REPLIED} if they reply._`;

  try {
    const sent = await channel.send({ content: msg, allowedMentions: { users: [member.id, greeter.id] } });
    data.rotation[greeter.id] = Date.now();
    data.welcomes[sent.id] = {
      memberId: member.id, username: member.user.username,
      joinedAt: Date.now(), greeterId: greeter.id, reachedOut: false, replied: false,
    };
    saveData();
    await sent.react('✅').catch(() => {});
    await sent.react('🗨️').catch(() => {}); // qualified so Discord accepts it
  } catch (e) {
    console.error('ERROR: The welcome-bot failed to post a message: ', e);
  }
});

// ---- a reaction lands ----
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const rec = data.welcomes[reaction.message.id];
  if (!rec) return;

  const emoji = normalizeEmoji(reaction.emoji?.name);
  if (emoji !== REACHED_OUT && emoji !== REPLIED) return;

  const guild = client.guilds.cache.get(GUILD_ID) ?? await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) return;
  const member = guild.members.cache.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null);
  if (!member || !member.roles.cache.has(ROLE_ID)) return;

  let changed = false;
  if (emoji === REACHED_OUT && !rec.reachedOut) { rec.reachedOut = true; changed = true; }
  if (emoji === REPLIED && !rec.replied) { rec.replied = true; changed = true; }
  if (changed) saveData();
});

// ---- a newcomer posts in 👋-introductions ----
// Matching is by user ID (from the record written at join time), not by name, so nickname
// changes and duplicate usernames can't fool it. Only the FIRST post is announced.
const introPending = new Set(); // guards against a double post if two messages land at once

client.on(Events.MessageCreate, async (message) => {
  if (!INTRO_ID || message.channelId !== INTRO_ID) return;
  if (message.author.bot) return;
  if (introPending.has(message.author.id)) return;

  const cutoff = Date.now() - INTRO_DAYS * 86400000;
  const records = Object.entries(data.welcomes)
    .filter(([, r]) => r.memberId === message.author.id && r.joinedAt >= cutoff)
    .sort((a, b) => b[1].joinedAt - a[1].joinedAt); // newest join first
  if (records.length === 0) return;                          // not a tracked newcomer
  if (records.some(([, r]) => r.introPostedAt)) return;      // already announced (covers rejoins)

  introPending.add(message.author.id);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('ERROR: Could not identify the Welcome channel — check CHANNEL_ID and permissions.');
      return;
    }

    const [promptId, rec] = records[0];
    // rec.greeterId is whoever was assigned to THIS newcomer back at join time — not whoever is
    // next in the rotation now. The rotation may have turned over many times since.
    const greeterPing = rec.greeterId ? `<@${rec.greeterId}>, ` : '';
    const content =
      `📝 ${greeterPing}<@${rec.memberId}> just posted in <#${INTRO_ID}> for the first time — ${message.url}`;
    const allowedMentions = { users: rec.greeterId ? [rec.greeterId] : [] }; // ping their greeter, not the newcomer

    // Reply to the original welcome prompt so the committee sees it in context.
    // Keys starting with "nc-" are joins that had no prompt message to reply to.
    const prompt = promptId.startsWith('nc-')
      ? null
      : await channel.messages.fetch(promptId).catch(() => null);
    if (prompt) await prompt.reply({ content, allowedMentions });
    else await channel.send({ content, allowedMentions });

    // Recorded on its own, with no emoji involved. 🗨 stays a manual "they replied to me" signal.
    rec.introPostedAt = Date.now();
    saveData();
  } catch (e) {
    console.error('ERROR: The welcome-bot failed to announce an intro post: ', e);
  } finally {
    introPending.delete(message.author.id);
  }
});

// ---- slash commands ----
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'welcome') return;

  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand();

  if (group === 'greeter') {
    const target = interaction.options.getMember('user');
    if (!target) {
      await interaction.reply({ content: 'Could not find that member.', ephemeral: true });
      return;
    }
    if (sub === 'snooze') {
      const until = interaction.options.getString('until');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        await interaction.reply({ content: 'Date must be YYYY-MM-DD (e.g. 2026-07-20).', ephemeral: true });
        return;
      }
      if (until <= new Date().toISOString().slice(0, 10)) {
        await interaction.reply({ content: 'Return date must be in the future.', ephemeral: true });
        return;
      }
      data.snoozed[target.id] = until;
      saveData();
      await interaction.reply({ content: `💤 Snoozed ${target.displayName} from the rotation until ${until}.` });
    } else if (sub === 'unsnooze') {
      if (!data.snoozed[target.id]) {
        await interaction.reply({ content: `${target.displayName} is not currently snoozed.`, ephemeral: true });
        return;
      }
      delete data.snoozed[target.id];
      saveData();
      await interaction.reply({ content: `${target.displayName} is back in the rotation.` });
    } else if (sub === 'skiptoback') {
      data.rotation[target.id] = Date.now();
      saveData();
      await interaction.reply({ content: `${target.displayName} moved to the back of the rotation (treated as just assigned).`, allowedMentions: { parse: [] } });
    } else if (sub === 'skiptofront') {
      delete data.rotation[target.id];
      saveData();
      await interaction.reply({ content: `${target.displayName} moved to the front of the rotation (treated as never assigned).`, allowedMentions: { parse: [] } });
    }
    return;
  }

  if (sub === 'rotation') {
    const guild = interaction.guild;
    await guild.members.fetch();
    const committee = guild.members.cache.filter((m) => m.roles.cache.has(ROLE_ID) && !m.user.bot);
    if (committee.size === 0) {
      await interaction.reply({ content: 'No one holds the Welcome Committee role right now.' });
      return;
    }
    const order = rotationOrder(committee);
    const snoozed = [...committee.values()].filter((m) => isSnoozed(m.id));
    const lines = [];
    if (order.length === 0) {
      lines.push('_(Everyone on the Welcome Committee is currently snoozed.)_');
    } else {
      lines.push(`🔜  Next up: **${order[0].displayName}**`);
      const rest = order.slice(1);
      lines.push(rest.length ? `Then: ${rest.map((m) => m.displayName).join(', ')}` : '_(Only one active person on the committee right now.)_');
    }
    if (snoozed.length) {
      lines.push('');
      lines.push('💤  Snoozed: ' + snoozed.map((m) => `${m.displayName} (back ${data.snoozed[m.id]})`).join(', '));
    }
    await interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'whosup') {
    const guild = interaction.guild;
    await guild.members.fetch();
    const committee = guild.members.cache.filter((m) => m.roles.cache.has(ROLE_ID) && !m.user.bot);
    const order = rotationOrder(committee);
    if (order.length === 0) {
      await interaction.reply({ content: 'No one is currently active in the Welcome Committee rotation.' });
      return;
    }
    await interaction.reply({ content: `🔜 Next up: **${order[0].displayName}**`, allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'stats') {
    const days = interaction.options.getInteger('days') ?? 30;
    const title = `**Welcome stats — last ${days} day${days === 1 ? '' : 's'}**`;
    await interaction.reply({ content: buildStatsText(days, title) });
    return;
  }
});

// ---- weekly summary ----
async function maybePostWeekly() {
  const now = new Date();
  if (now.getDay() !== WEEKLY_DAY || now.getHours() < WEEKLY_HOUR) return;
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (data.lastWeekly === todayKey) return; // already posted today

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send(buildStatsText(7, '📅  **Weekly welcome summary — last 7 days**')).catch(() => {});
  data.lastWeekly = todayKey;
  saveData();
}

client.login(TOKEN);
