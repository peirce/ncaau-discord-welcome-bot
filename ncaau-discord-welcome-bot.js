
const fs = require('node:fs');
const {
  Client, GatewayIntentBits, Events, Partials, SlashCommandBuilder, MessageType, SystemChannelFlagsBitField,
} = require('discord.js');

// ---------------- CONFIG ----------------
const TOKEN       = process.env.DISCORD_TOKEN;  // From .env file
const GUILD_ID    = process.env.GUILD_ID;    // NCAAU Discord SERVER id
const CHANNEL_ID  = process.env.CHANNEL_ID;  // 👋-welcome-committee CHANNEL id
const ROLE_ID     = process.env.ROLE_ID;     // Welcome Committee ROLE id
const INTRO_ID    = process.env.INTRO_CHANNEL_ID; // 👋-introductions CHANNEL id (optional -- blank turns the watch off)
const STATE_FILE  = './welcome-data.json';
const WEEKLY_DAY  = 1;  // Weekly summary day: 0=Sun, 1=Mon ... 6=Sat
const WEEKLY_HOUR = 9;  // Weekly summary hour (24h), in the HOST machine's local time
const INTRO_DAYS  = 30; // Only announce an intro post from someone who joined within this many days
const CATCHUP_DAYS = 7;  // On startup, look back this many days for joins missed while the bot was down (0 turns it off)
const CATCHUP_MAX  = 10; // Announce at most this many missed joins at once, so a lost state file can't flood the channel
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

// ---- Persistent state ----
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

// Aside from stats commands, only committee members can run slash commands
function isCommittee(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  return Array.isArray(roles) ? roles.includes(ROLE_ID) : roles.cache.has(ROLE_ID);
}

const INDEFINITE = 'indefinite'; // data.snoozed value for a snooze with no return date

function isSnoozed(userId) {
  const until = data.snoozed[userId];
  if (until === INDEFINITE) return true;
  return !!until && new Date().toISOString().slice(0, 10) < until;
}

// Rotation order: longest-waiting first (never-assigned counts as 0); snoozed members excluded
function rotationOrder(committee) {
  return [...committee.values()]
    .filter((m) => !isSnoozed(m.id))
    .sort((a, b) => {
      const ta = data.rotation[a.id] ?? 0;
      const tb = data.rotation[b.id] ?? 0;
      return ta !== tb ? ta - tb : a.id.localeCompare(b.id);
    });
}

const RULE = '━'.repeat(28);

// Shared stats text for /stats and the weekly post
function buildStatsText(days, title) {
  const cutoff = Date.now() - days * 86400000;
  const records = Object.values(data.welcomes).filter((r) => r.joinedAt >= cutoff);
  const joins = records.length;
  if (joins === 0) {
    return [RULE, title, `No joins recorded in the last ${days} day${days === 1 ? '' : 's'}.`, RULE].join('\n');
  }
  const reached = records.filter((r) => r.reachedOut).length;
  const replied = records.filter((r) => r.replied).length;
  const intros  = records.filter((r) => r.introPostedAt).length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const lines = [
    RULE,
    title,
    `New joins: ${joins}`,
    `✅ Reached out: ${reached} (${pct(reached, joins)}% of joins)`,
    `🗨 Replied: ${replied} (${pct(replied, joins)}% of joins · ${pct(replied, reached)}% of those contacted)`,
  ];
  // Counted by the bot itself, not from reactions -- so it's only shown when the watch is on.
  if (INTRO_ID) lines.push(`📝 Posted an intro: ${intros} (${pct(intros, joins)}% of joins)`);
  lines.push(RULE);
  return lines.join('\n');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,          // privileged -- toggle ON in the Dev Portal
    GatewayIntentBits.GuildMessageReactions, // standard -- no portal toggle
    GatewayIntentBits.GuildMessages,         // standard -- needed to see posts in 👋-introductions
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User], // catch reactions on uncached msgs
});

// ---- Slash command definitions ----
const welcomeCommand = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Welcome Committee tools.')
  .addSubcommand((sub) =>
    sub.setName('snooze')
      .setDescription('Pauses someone from the rotation until DATE (YYYY-MM-DD), or indefinitely if no date.')
      .addUserOption((opt) => opt.setName('user').setDescription('Member to snooze.').setRequired(true))
      .addStringOption((opt) => opt.setName('until').setDescription('Return date (YYYY-MM-DD). Leave blank for no return date.'))
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
  .addSubcommand((sub) =>
    sub.setName('rotation')
      .setDescription('Shows the full rotation queue and any snoozes.')
  )
  .addSubcommand((sub) =>
    sub.setName('whosup')
      .setDescription("Shows who's next in the welcome rotation.")
  )
  .addSubcommand((sub) =>
    sub.setName('pairs')
      .setDescription('Shows which committee member greeted which new members, from the ✅ reactions.')
      .addIntegerOption((opt) =>
        opt.setName('days').setDescription('Or for the last how many days? (Default is 30.)').setMinValue(1)
      )
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
  let guild;
  try {
    guild = await c.guilds.fetch(GUILD_ID);
    await guild.commands.set([welcomeCommand.toJSON()]);
    console.log('The welcome-bot is on duty. Use /welcome to see a list of commands.');
  } catch (e) {
    console.error('ERROR during startup -- check GUILD_ID and bot permissions:', e);
    process.exit(1);
  }
  maybePostWeekly();
  setInterval(maybePostWeekly, 15 * 60 * 1000); // re-check every 15 min

  // The downtime recovery is last so it can't hold up the rest of startup.
  try {
    await catchUpOnMissedJoins(guild);
  } catch (e) {
    console.error('The welcome bot is operational, but a startup error occurred during downtime recovery which may prevent new members who joined during the downtime from being recognized, so please check manually for any recently missed joins:', e);
  }
});

// Discord posts a "X joined the server" system message.
// Returns null if join notifications are off, or if there's no system channel, 
// or if the bot can't see it any of which just means the prompt goes out with no link.
async function findJoinMessageUrl(guild, member) {
  if (guild.systemChannelFlags.has(SystemChannelFlagsBitField.Flags.SuppressJoinNotifications)) return null;
  const sysChannel = guild.systemChannel;
  if (!sysChannel) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    const messages = await sysChannel.messages.fetch({ limit: 5 }).catch(() => null);
    const joinMsg = messages?.find((m) => m.type === MessageType.UserJoin && m.author.id === member.id);
    if (joinMsg) return joinMsg.url;
  }
  return null;
}

// Everyone currently holding the Welcome Committee role. The fetch fills the member cache, so the
// role filter sees the whole server and not just whoever the bot happens to have seen recently.
async function committeeMembers(guild) {
  await guild.members.fetch();
  return guild.members.cache.filter((m) => m.roles.cache.has(ROLE_ID) && !m.user.bot);
}

function howLongAgo(ts) {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Assigns the next greeter, posts the prompt, and records the welcome.
// This is used during live joins and downtime recovery.
async function announceJoin(channel, member, committee, { joinedAt, joinMsgUrl, catchUp = false }) {
  const available = rotationOrder(committee); // excludes snoozed members
  const lateNote = `⏳ Missed while the bot was offline -- they joined ${howLongAgo(joinedAt)}.`;

  if (available.length === 0) {
    const reason = committee.size === 0
      ? 'No one holds the Welcome Committee role right now'
      : 'All Welcome Committee members are currently snoozed';
    const lines = [`👋 Welcome <@${member.id}>! (${reason} -- Someone please say hi.)`];
    if (catchUp) lines.push(lateNote);
    if (joinMsgUrl) lines.push(`🔗 ${joinMsgUrl}`);
    data.welcomes[`nc-${member.id}-${Date.now()}`] = {
      memberId: member.id, username: member.user.username,
      joinedAt, greeterId: null, reachedOut: false, replied: false, noCommittee: true,
      ...(catchUp && { catchUp: true }),
    };
    saveData();
    await channel.send({ content: lines.join('\n'), allowedMentions: { users: [member.id] } }).catch(() => {});
    return;
  }

  const greeter = available[0];
  const lines = [
    `<@${greeter.id}>, you're up -- please say hello along with the events calendar screenshot in the General channel, and DM <@${member.id}>. 🤝`,
  ];
  if (catchUp) lines.push(lateNote);
  if (joinMsgUrl) lines.push(`🔗 ${joinMsgUrl}`);
  lines.push(`_React with ${REACHED_OUT} once you've reached out, and ${REPLIED} if they reply._`);

  const sent = await channel.send({
    content: lines.join('\n'),
    allowedMentions: { users: [member.id, greeter.id] },
  });
  data.rotation[greeter.id] = Date.now();
  data.welcomes[sent.id] = {
    memberId: member.id, username: member.user.username,
    joinedAt, greeterId: greeter.id, reachedOut: false, replied: false,
    ...(catchUp && { catchUp: true }),
  };
  saveData();
  await sent.react('✅').catch(() => {});
  await sent.react('🗨️').catch(() => {}); // qualified so Discord accepts it
}

// ---- Server join ----

const joinsInFlight = new Set();

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  const guild = member.guild;

  joinsInFlight.add(member.id);
  try {
    const channel = await guild.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('ERROR: Could not identify the Welcome channel -- check CHANNEL_ID and permissions.');
      return;
    }

    const joinMsgUrl = await findJoinMessageUrl(guild, member);
    const committee = await committeeMembers(guild);
    // Discord's own join time so the downtime recovery can match this record to the member later.
    await announceJoin(channel, member, committee, {
      joinedAt: member.joinedTimestamp ?? Date.now(),
      joinMsgUrl,
    });
  } catch (e) {
    console.error('ERROR: The welcome-bot failed to post a message: ', e);
  } finally {
    joinsInFlight.delete(member.id);
  }
});

// ---- Downtime recovery ----

// A join counts as already handled if there's a record for that member near the same join time.
// Comparing times along with IDs means someone who left and rejoined correctly gets a fresh welcome 
// instead of being mistaken for their older record.
const SAME_JOIN_MS = 10 * 60 * 1000;
function alreadyRecorded(memberId, joinedAt) {
  return Object.values(data.welcomes)
    .some((r) => r.memberId === memberId && Math.abs(r.joinedAt - joinedAt) < SAME_JOIN_MS);
}

// Maps user ID to the URL of their "joined the server" post.
// An empty map just means the downtime recovery prompts go out without their jump links.
async function recentJoinMessageUrls(guild, since) {
  const urls = new Map();
  if (guild.systemChannelFlags.has(SystemChannelFlagsBitField.Flags.SuppressJoinNotifications)) return urls;
  const sysChannel = guild.systemChannel;
  if (!sysChannel) return urls;

  let before;
  for (let page = 0; page < 5; page++) { // 5 x 100 messages is far more than a week of General
    const batch = await sysChannel.messages.fetch({ limit: 100, ...(before && { before }) }).catch(() => null);
    if (!batch?.size) break;
    for (const m of batch.values()) {
      if (m.type === MessageType.UserJoin && !urls.has(m.author.id)) urls.set(m.author.id, m.url);
    }
    const oldest = batch.last();
    if (oldest.createdTimestamp < since) break; // walked back past the window
    before = oldest.id;
  }
  return urls;
}

async function catchUpOnMissedJoins(guild) {
  if (!CATCHUP_DAYS) return;

  const channel = await guild.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('Downtime recovery skipped: Could not identify the Welcome channel -- check CHANNEL_ID and permissions.');
    return;
  }

  const since = Date.now() - CATCHUP_DAYS * 86400000;
  const committee = await committeeMembers(guild); // also fills the member cache read just below
  let queue = [...guild.members.cache.values()]
    .filter((m) => !m.user.bot && !joinsInFlight.has(m.id)
      && m.joinedTimestamp >= since && !alreadyRecorded(m.id, m.joinedTimestamp))
    .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp); // oldest first, so the rotation advances in join order

  if (queue.length === 0) {
    console.log(`Startup / Downtime recovery: nothing missed in the last ${CATCHUP_DAYS} days.`);
    return;
  }

  const total = queue.length;
  const held = queue.slice(0, Math.max(0, total - CATCHUP_MAX)).map((m) => m.user.username);
  queue = queue.slice(-CATCHUP_MAX);

  const header = [
    `🔄 **Downtime recovery** -- ${total} join${total === 1 ? '' : 's'} from the last ${CATCHUP_DAYS} days went unannounced while the bot was offline.` +
      (held.length ? ` Posting the ${queue.length} most recent:` : ''),
  ];
  if (held.length) {
    header.push(`_Held back for now (over the ${CATCHUP_MAX}-at-a-time limit; they come up on the next restart): ${held.join(', ')}._`);
  }
  await channel.send({ content: header.join('\n'), allowedMentions: { parse: [] } }).catch(() => {});

  const joinUrls = await recentJoinMessageUrls(guild, since);
  let posted = 0;
  for (const member of queue) {
    try {
      await announceJoin(channel, member, committee, {
        joinedAt: member.joinedTimestamp,
        joinMsgUrl: joinUrls.get(member.id) ?? null,
        catchUp: true,
      });
      posted++;
    } catch (e) {
      console.error(`Downtime recovery: Failed to announce ${member.user.username}:`, e);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200)); // paced to stay clear of rate limits
  }
  console.log(`Downtime recovery: Announced ${posted} of ${total} missed join(s).`);
}

// ---- Emoji reactions ----
// Each mark records WHO clicked, not just that someone did. 
//   rec.greeterId is who the rotation assigned to welcome.
//   reachedOutBy is who said they welcomed (by checkmarking).
// The Welcome Committee role via carl-bot limits who's in the channel but there are other ways in, such as admins.
// The role doesn't limit the stats in terms of who has credit and is paired with whom.
// Credit goes to the first person to click. Every click is also kept, in order, so that if
// the credited person removes their mark (correcting a mis-click) then credit can pass to the next one.
// repliedConfirmedBy is whomever reported the newcomer's reply.

const MARKS = {
  [REACHED_OUT]: { flag: 'reachedOut', by: 'reachedOutBy',       at: 'reachedOutAt', clicks: 'reachedOutClicks' },
  [REPLIED]:     { flag: 'replied',    by: 'repliedConfirmedBy', at: 'repliedAt',    clicks: 'repliedClicks' },
};

// ---- Reaction arrival ----

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const rec = data.welcomes[reaction.message.id];
  if (!rec) return;

  const mark = MARKS[normalizeEmoji(reaction.emoji?.name)];
  if (!mark) return;

  const clicks = (rec[mark.clicks] ??= []);
  if (clicks.some((c) => c.id === user.id)) return;
  const at = Date.now();
  clicks.push({ id: user.id, at });
  if (!rec[mark.flag]) {
    rec[mark.flag] = true;
    rec[mark.by] = user.id;
    rec[mark.at] = at;
  }
  saveData();
});

// ---- Reaction removal ----
// If the credited member takes their mark back, credit passes to the earliest click the bot saw that's
// still on the message. Failing that, to anyone still showing the mark (e.g. they clicked
// while the bot was offline, so there's no click order to go by). Elsewise, the mark is cleared,
// so a ✅ welcome goes back to awaiting a ✅ in /welcome pairs.
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const rec = data.welcomes[reaction.message.id];
  if (!rec) return;

  const mark = MARKS[normalizeEmoji(reaction.emoji?.name)];
  if (!mark) return;

  const clicks = rec[mark.clicks] ?? [];
  const wasCredited = rec[mark.by] === user.id;
  if (!wasCredited && !clicks.some((c) => c.id === user.id)) return; // a click the bot never counted
  rec[mark.clicks] = clicks.filter((c) => c.id !== user.id);

  if (wasCredited) {
    // Who has this mark on the message right now, per Discord. If Discord can't be reached, the
    // bot's own click list is all there is to go on.
    const onMessage = await reaction.users.fetch().catch(() => null);
    if (onMessage) {
      rec[mark.clicks] = rec[mark.clicks].filter((c) => onMessage.has(c.id)); // drops removals missed while offline
      if (rec[mark.clicks].length === 0) {
        for (const u of onMessage.values()) {
          if (u.bot || u.id === user.id) continue;
          rec[mark.clicks].push({ id: u.id, at: Date.now() }); // their real click time is unknown
          break;
        }
      }
    }
    const next = rec[mark.clicks][0];
    if (next) {
      rec[mark.by] = next.id;
      rec[mark.at] = next.at;
    } else {
      rec[mark.flag] = false;
      delete rec[mark.by];
      delete rec[mark.at];
    }
  }
  saveData();
});

// ---- A newcomer posts in 👋-introductions ----
// Matching is by user ID (from the record written at join time), not by name, so nickname
// changes and duplicate usernames can't fool it. Only the FIRST post is announced.
const introPending = new Set(); // guards against a double post if two messages arrive at once

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
      console.error('ERROR: Could not identify the Welcome channel -- check CHANNEL_ID and permissions.');
      return;
    }

    const [promptId, rec] = records[0];
    // rec.greeterId is whoever was assigned to THIS newcomer back at join time -- not whoever is
    // next in the rotation now. The rotation may have turned over many times since.
    const lead = rec.greeterId ? `<@${rec.greeterId}>, in case` : 'In case';
    // Discord renders message.url as "#channel > 🗨".
    const content =
      `📝 ${lead} you'd like to respond or react with an emoji, <@${rec.memberId}> posted in ${message.url}`;
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

// ---- Slash commands ----
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'welcome') return;

  const sub = interaction.options.getSubcommand();

  // Slash commands are shown to everyone, but aside from stats commands, only only committee members can run them,
  // so non-members get a private error message.
  if (sub !== 'stats' && !isCommittee(interaction)) {
    await interaction.reply({
      content: `Sorry -- only <@&${ROLE_ID}> members can use that command. (\`/welcome stats\` is open to everyone.)`,
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
    return;
  }

  if (['snooze', 'unsnooze', 'skiptoback', 'skiptofront'].includes(sub)) {
    const target = interaction.options.getMember('user');
    if (!target) {
      await interaction.reply({ content: 'Could not find that member.', ephemeral: true });
      return;
    }
    if (sub === 'snooze') {
      const until = interaction.options.getString('until');
      // null = no return date (indefinite vacation; also for welcomers who don't want to be in the rotation)
      if (until !== null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
          await interaction.reply({ content: 'Date must be YYYY-MM-DD (e.g. 2026-07-20), or leave it blank for no return date.', ephemeral: true });
          return;
        }
        if (until <= new Date().toISOString().slice(0, 10)) {
          await interaction.reply({ content: 'Return date must be in the future, or leave it blank for no return date.', ephemeral: true });
          return;
        }
      }
      data.snoozed[target.id] = until ?? INDEFINITE;
      saveData();
      const howLong = until ? `until ${until}` : 'indefinitely, until someone runs `/welcome unsnooze`';
      await interaction.reply({ content: `💤 Snoozed ${target.displayName} from the rotation ${howLong}.` });
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
      const back = (id) => (data.snoozed[id] === INDEFINITE ? 'no return date' : `back ${data.snoozed[id]}`);
      lines.push('💤 Snoozed: ' + snoozed.map((m) => `${m.displayName} (${back(m.id)})`).join(', '));
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

  if (sub === 'pairs') {
    const days = interaction.options.getInteger('days') ?? 30;
    const cutoff = Date.now() - days * 86400000;
    const title = `**Welcome pairings -- last ${days} day${days === 1 ? '' : 's'}**`;
    const records = Object.values(data.welcomes)
      .filter((r) => r.joinedAt >= cutoff)
      .sort((a, b) => b.joinedAt - a.joinedAt); // newest join first
    if (records.length === 0) {
      await interaction.reply({ content: `${title}\nNo joins recorded in that window.` });
      return;
    }

    const guild = interaction.guild;
    await guild.members.fetch();
    // Falls back to a silenced mention for anyone who has since left the server.
    const nameOf = (id) => guild.members.cache.get(id)?.displayName ?? `<@${id}>`;

    // Grouped by who clicked ✅, which is the real pairing -- not necessarily who the rotation assigned.
    const byGreeter = new Map();
    const pending = [];
    let anyLegacy = false;
    let anyHandover = false;
    for (const rec of records) {
      const id = rec.reachedOut ? (rec.reachedOutBy ?? rec.greeterId) : null;
      if (!id) { pending.push(rec); continue; }
      if (!byGreeter.has(id)) byGreeter.set(id, []);
      byGreeter.get(id).push(rec);
    }

    const lines = [title];
    for (const [id, recs] of [...byGreeter.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const names = recs.map((rec) => {
        const marks = [];
        if (rec.replied) marks.push(REPLIED);
        if (rec.introPostedAt) marks.push('📝');
        if (!rec.reachedOutBy) { marks.push('?'); anyLegacy = true; }
        else if (rec.greeterId && rec.reachedOutBy !== rec.greeterId) {
          marks.push(`(assigned to ${nameOf(rec.greeterId)})`);
          anyHandover = true;
        }
        return marks.length ? `${rec.username} ${marks.join(' ')}` : rec.username;
      });
      lines.push(`${REACHED_OUT} **${nameOf(id)}** (${recs.length}): ${names.join(', ')}`);
    }
    if (byGreeter.size === 0) lines.push(`_(Nobody has clicked ${REACHED_OUT} on a welcome in this window.)_`);
    if (pending.length) {
      lines.push('');
      lines.push(`⏳ **Awaiting a ${REACHED_OUT}:** ` + pending
        .map((rec) => `${rec.username} (${rec.greeterId ? nameOf(rec.greeterId) : 'unassigned'})`)
        .join(', '));
    }

    const legend = [`${REPLIED} replied`];
    if (INTRO_ID) legend.push('📝 posted an intro');
    if (anyHandover) legend.push('a name in parentheses is who the rotation had assigned');
    if (anyLegacy) legend.push('? = greeted before the bot recorded who clicked');
    lines.push('');
    lines.push(`_Grouped by who clicked ${REACHED_OUT}. ${legend.join(' · ')}._`);

    let content = lines.join('\n');
    if (content.length > 1900) content = `${content.slice(0, 1900)}\n… _(truncated -- try a shorter days window)_`;
    await interaction.reply({ content, allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'stats') {
    const days = interaction.options.getInteger('days') ?? 30;
    const title = `**Welcome stats -- last ${days} day${days === 1 ? '' : 's'}**`;
    await interaction.reply({ content: buildStatsText(days, title) });
    return;
  }
});

// ---- Weekly summary ----
async function maybePostWeekly() {
  const now = new Date();
  if (now.getDay() !== WEEKLY_DAY || now.getHours() < WEEKLY_HOUR) return;
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (data.lastWeekly === todayKey) return; // already posted today

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send(buildStatsText(7, '📅  **Weekly welcome summary -- last 7 days**')).catch(() => {});
  data.lastWeekly = todayKey;
  saveData();
}

client.login(TOKEN);
