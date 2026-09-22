# ncaau-discord-welcome-bot

## What this bot does

When someone joins the NCAAU Discord server, the bot posts a message in the Welcome Committee channel tagging the new member along with the committee member whose turn it is, and pre-adds the ✅ and 🗨 emojis to its own message so the committee can track follow-up with one click. If the server has "someone joined" system messages turned on, the prompt also includes a 🔗 jump link straight to Discord's own join message for that member. If that setting is off, or the bot can't see the system channel, or the system message just hasn't arrived yet, the prompt is sent without a link.

Whose turn it is = whoever has waited longest since they were last assigned. Someone who has never been assigned counts as waiting the longest, so new committee members go to the front. Members who are snoozed are skipped entirely.

Downtime recovery: If the bot is down when someone joins, that join is picked up the next time the bot starts.

The bot reads the Welcome Committee role to find out who is on the committee.

It optionally watches an introductions channel where new members might introduce themselves and notifies the newcomer's greeter about the introduction.

It also records which committee member greeted which new member, taken from whoever clicked ✅ -- see `/welcome pairs`.

It also keeps some basic stats: how many people joined, how many got greeted, how many replied, and how many posted an introduction. Joins and intro posts are tracked by the bot on its own; Greetings and replies come from the ✅ and 🗨 emoji reactions. The bot auto-posts a weekly summary to the Welcome Committee channel, and stats on demand with a customizable timespan.

## The bot's slash commands

While the bot is running, Welcome Committee members can use these slash commands. The two `stats` commands are the exception: anyone in the server can run those. (In the commands below, uppercase indicates something you have to replace when entering the command.)

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/welcome rotation` | Committee | Shows the full rotation queue and any snoozes. |
| `/welcome whosup` | Committee | Shows who's next in the welcome rotation. |
| `/welcome pairs` | Committee | Shows which committee member greeted which new members over the last 30 days. |
| `/welcome pairs DAYS` | Committee | Shows the same pairings for the last DAYS days. |
| `/welcome skiptoback USER` | Committee | Moves them to the back of the rotation queue. |
| `/welcome skiptofront USER` | Committee | Moves them to the front of the rotation queue. |
| `/welcome snooze USER DATE` | Committee | Pauses someone from the rotation until DATE (YYYY-MM-DD). |
| `/welcome snooze USER` | Committee | Pauses someone from the rotation indefinitely, with no return date, until someone unsnoozes them. |
| `/welcome unsnooze USER` | Committee | Cancels the snooze early: Returns someone to the rotation. |
| `/welcome stats` | Anyone | Shows join count, reach-out rate, reply rate, and intro-post rate for the last 30 days. |
| `/welcome stats DAYS` | Anyone | Shows the same stats for the last DAYS days. |

Discord still lists every command for everyone, so a non-committee member who tries a restricted one gets a private "committee members only" reply that nobody else in the channel sees.

There is no command for adding or removing a greeter. Committee membership is managed outside this bot: The bot only reads the Welcome Committee role and never adds or removes it. To add or remove someone, assign or unassign that role in Discord (by hand, or however your server hands out roles). The rotation picks up the change on its own.

## Dev setup and basic file setup

- MS Windows.
- Open VS Code.
- Open a terminal inside VS Code (assumed to be powershell)
- Run these commands:

```powershell
winget install OpenJS.NodeJS.LTS
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
node --version
```

Needs Node.js 20.6 or newer, since the bot is launched with the `--env-file` flag, which doesn't exist before that version (the LTS install above already satisfies this). If `node --version` shows something older, update Node before continuing.

```powershell
cd D:\Main\activism\NCAAU\discord_bot\
git clone https://github.com/peirce/ncaau-discord-welcome-bot.git
cd ncaau-discord-welcome-bot
npm install
vi .gitignore
    .env
    welcome-data.json
    node_modules
ESC :wq ENTER
cp .env.EXAMPLE .env
```

About that `npm install`: it reads package.json and downloads discord.js into a node_modules folder inside THIS directory. You must run this from inside ncaau-discord-welcome-bot, after cloning -- running "npm install" before/outside the repo folder installs into the wrong directory and the bot will fail with "Cannot find module 'discord.js'". node_modules is gitignored, so re-run "npm install" any time you pull changes that update package.json.


## Bot setup

Go to...
<https://discord.com/developers/applications>

- New Application --> Bot tab.
- Name it... welcome-bot
- Bot --> Token --> Reset Token --> Copy it and put it in the .env file as the value of DISCORD_TOKEN.
- Bot --> Token --> Privileged Gateway Intents --> Server Members Intent under --> Toggle it on.
- Save Changes.
- Bot --> Bot Permissions --> Ignore this set of checkboxes and don't confuse it with the same thing under OAuth2.
- OAuth2 --> URL Generator --> Scopes --> Checkmark this:
    - bot
- OAuth2 --> URL Generator --> Bot Permissions --> Checkmark these:
    - View Server Insights
    - Send Messages
    - Embed Links
    - Read Message History
    - Mention Everyone
    - Use External Emojis
    - Use External Stickers
    - Add Reactions
    - Use Slash Commands

(If the bot needs rebuilt, Manage Roles might be a good permission to add, so the bot can look up ROLE_ID itself.)

That results in a "Generated URL" at the bottom (a.k.a. "the invite link" which you will copy+paste into your message to the server admin.)

Example invite link:

```text
https://discord.com/oauth2/authorize?client_id=1517759839546114139&permissions=139587438656&integration_type=0&scope=bot
```

The checkmarks on the page that generate the invite link cannot be saved and do not persist across tab navigation, but that's fine because the checkmarks will be baked into the invite link. (If you see a Permissions Integer you're probably on the wrong page.)

Send a message like this along with the invite link to a server owner: (Test on your own server first.)

```text
1. Please create a role called "Welcome Committee" (or whatever you want to name it). I assume Carl-bot will allow me to add myself by emoji to that role.

2. Please create a channel called 👋-welcome-committee (or whatever you want to name it).

3. Open this invite link and authorize the bot:
    (((paste the invite link here)))
    The bot will show as offline until I start it -- That's normal.

4. Add the welcome-bot user to the welcome committee channel. (The welcome-bot user is different from the bot permissions role that Discord generates automatically.)

5. Turn on Developer Mode (in User Settings which is the gear icon near your username --> Advanced section or Developer section --> toggle on Developer Mode).

6. Right-click the Welcome Committee role --> Copy Role ID and send it to me please.
...or ask carl-bot with a slash command such as... /role allroles

I'll gather the other IDs and fire up the bot. I'll host the bot on my computer, unless you'd like it to be hosted somewhere else like your computer or a dedicated always-on system like Pi or a small VPS. (A bot is a continuous responsibility to maintain extremely high uptime, because it can only catch users joining the Discord server while the bot is running. Therefore if hosting on a PC, an uninterruptable power supply (UPS) is recommended for when weather-related outages and such inevitably occur since a backup generator usually isn't fast enough to prevent a PC from turning off.)
```

Open .env and paste in the four IDs as GUILD_ID, CHANNEL_ID, ROLE_ID, and INTRO_CHANNEL_ID.

INTRO_CHANNEL_ID is the only optional one. Leave it blank and the bot simply skips the introductions watch, while everything else works the same.

Discord doesn't host bots. Think of a bot less like a server customization, and more like a member with their own individual role packaging their permissions, who can join a server, so you have to run it on your computer or somewhere.

Double-click launch-bot.bat to start the bot.

Inform the server Welcome Committee where the discord bot's codebase is located, initially here...
<https://github.com/peirce/ncaau-discord-welcome-bot>


## Auto-start the bot when Windows starts up

This is only applicable if the bot is hosted on a Windows computer, but something analogous should be done in other cases.

- Start menu --> Search --> Task Scheduler
- Action --> Create Basic Task
- Name: NCAAU Discord Welcome Bot --> Next
- Trigger: When the computer starts --> Next
- Action: Start a program --> Next
- Program/script: D:\Main\activism\NCAAU\discord_bot\ncaau-discord-welcome-bot\launch-bot.bat
- Next --> Finish
- Right-click the new task --> Properties
- General tab --> check "Run whether user is logged on or not"
- OK (Windows will prompt for your password.)

To test it without rebooting:

- Task Scheduler --> left panel --> Task Scheduler Library --> Right-click the task --> Run

## Downtime recovery

A join only reaches the bot as a live event. If the bot is offline then anyone who joins during that window is never announced and never written to the data file.

So every time the bot starts, before anything else it compares the server's member list (not the "someone joined" posts in the General channel) against welcome-data.json, and announces whatever it finds missing. Every member carries the exact timestamp of when they joined. The General channel is read only to recover the jump links for those joins.

A recovery join is handled just like a live one -- next person in the rotation, same prompt, same ✅ and 🗨 reactions, same record -- with one extra line saying it was missed and how long ago the person joined.

Before the batch, the bot posts one line saying how many it's catching up on. If there's nothing to catch up on -- the normal case -- it posts nothing at all and just notes it in the console.

Notes on how it behaves:

- It looks back 7 days. A join older than that is treated as water under the bridge and left alone.
- It announces at most 10 at once (CATCHUP_MAX). That's a guard against welcome-data.json being lost or corrupted, which would otherwise make every recent member look un-greeted and flood the welcome channel. Over the limit, the most recent joins go out and the older ones are named in the header as held back; since they get no record, they come up again on the next restart, so the backlog drains rather than being dropped.
- Anyone already in welcome-data.json is skipped, so restarting the bot doesn't re-announce anyone.
- The match is on member ID *and* join time, so someone who left and rejoined during the downtime is intentionally treated as a new join and gets a fresh welcome rather than being mistaken for their older record. (That's intentional because they may not even recall having joined for a couple minutes.)
- Someone who joined and then left again before the bot came back up is not announced. They're gone from the member list, so there's nobody to welcome.
- The rotation is honoured by downtime recovery.
- The posts are paced about a second apart to stay clear of Discord's rate limits.
- It runs after the rest of startup, so a slow or failing recovery can't stop the bot coming online.
- Caught-up records are flagged with `"catchUp": true` in welcome-data.json. Nothing in the stats treats them differently; it's there so it's clear why a welcome went out late.

## Watching the introductions channel

When the bot posts a welcome prompt, it records the new member's user ID alongside that message. Then it watches the introductions channel for the first time that new member posts there, at which point it replies to its own original welcome prompt message in the Welcome Committee channel.

The point is so the greeter is aware someone they greeted has introduced themselves, so the greeter can go reply to the introduction message, if they so choose, adding to the personal touch.

Notes on how it behaves:

- Matching is by user ID, not by name, so a nickname or username change doesn't break it.
- Only the first post is announced. Everything that member posts after that is ignored.
- An intro posted during the downtime is missed because the bot only ever sees messages posted while it's running.
- It ignores intro posts from anyone who joined more than 30 days ago, so a long-time member finally posting an intro doesn't set off a stale welcome.
- The bot never posts in the introductions channel.
- The channel is set by ID in the .env file, not by name, so renaming the channel doesn't break it either.
- This assumes the introductions channel is public. The bot sees it the same way any member does, through @everyone, so nothing has to be granted to the bot specifically. If that channel is ever made private, the bot silently stops seeing posts in it -- no error, no log, announcements just quietly stop -- until the bot is given permission to view the channel.

## Stats & Emojis

Stats are only as good as the emoji reactions Welcome Committee members add to the bot's messages:

✅  React with this emoji once you've reached out to the new member.

🗨  React with this emoji if the new member replies to you.

📝  No emoji reaction is needed for this one. Intro posts are tracked automatically, counted by the bot in its own stats -- see the section above. Don't click 🗨 for an intro post; the two are tracked separately on purpose, so you can see how many newcomers posted in 👋-introductions versus how many answered a greeting.

How emoji reactions get counted:

- Reactions count no matter which roles the person clicking holds. Anyone who can see the Welcome Committee channel can click ✅ or 🗨 and have it register. Roles aren't the only way to see the channel.

- Only reactions on the bot's own welcome messages count. Reacting to some other message in the channel isn't counted.

- The bot records who clicked ✅ or 🗨, not just that someone did. That's what `/welcome pairs` reports.

- The bot pre-adds ✅ and 🗨 to its own messages so Welcome Committee members don't have to search for the emoji. Neither of its own pre-added reactions counts towards anything -- the bot ignores reactions from any bot, including itself, so a stat only moves when a human clicks the emoji.


## Who greeted whom

`/welcome pairs` lists new members grouped by the committee member who greeted them, and it groups by **who clicked ✅**, not by who the rotation assigned.

New members still waiting on a ✅ are listed separately at the bottom, with their assigned greeter in parentheses, so it's easy to see what's outstanding.

Markers next to a newcomer's name: 🗨 they replied, 📝 they posted an intro. A `?` means that welcome was greeted before the bot started recording who clicked, so the name it's filed under is the assigned greeter rather than a confirmed clicker. Those only appear on welcomes from before this feature was added; nothing new gets a `?`.

Pairings are read from the same records the stats come from, so anyone who was greeted before the bot was tracking clicks keeps their `?` permanently -- that information wasn't saved at the time and can't be recovered.

## Weekly summary

Once a week the bot posts a summary of the last 7 days to the Welcome Committee channel, in the same format as `/welcome stats`. Nobody has to trigger it.

By default it posts Mondays at 9am, in the local time of the machine running the bot -- not in any Discord member's own timezone. If the bot isn't running at that moment it posts the next time it is running later that same day; if it's down all day it skips that week. It posts at most once a day.

The day and hour are the WEEKLY_DAY and WEEKLY_HOUR settings at the top of ncaau-discord-welcome-bot.js.
