# ncaau-discord-welcome-bot

## What this bot does

When someone joins the NCAAU Discord server, the bot posts a message in the Welcome Committee channel tagging the new member along with the committee member whose turn it is, and pre-adds the ✅ and 🗨 emojis to its own message so the committee can track follow-up with one click.

Whose turn it is = whoever has waited longest since they were last assigned. Someone who has never been assigned counts as waiting the longest, so new committee members go to the front. Members who are snoozed are skipped entirely.

The bot reads the Welcome Committee role to find out who is on the committee.

It optionally watches an introductions channel where new members might introduce themselves and notifies the newcomer's greeter about the introduction.

It also keeps some basic stats: how many people joined, how many got greeted, how many replied, and how many posted an introduction. Joins and intro posts are tracked by the bot on its own; Greetings and replies come from the ✅ and 🗨 emoji reactions. The bot auto-posts a weekly summary to the Welcome Committee channel, and stats on demand with a customizable timespan.

## The bot's slash commands

While the bot is running, Welcome Committee members can use these slash commands. The two `stats` commands are the exception: anyone in the server can run those. (In the commands below, uppercase indicates something you have to replace when entering the command.)

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/welcome rotation` | Committee | Shows the full rotation queue and any snoozes. |
| `/welcome whosup` | Committee | Shows who's next in the welcome rotation. |
| `/welcome greeter skiptoback USER` | Committee | Moves them to the back of the rotation queue. |
| `/welcome greeter skiptofront USER` | Committee | Moves them to the front of the rotation queue. |
| `/welcome greeter snooze USER DATE` | Committee | Pauses someone from the rotation until DATE (YYYY-MM-DD). |
| `/welcome greeter unsnooze USER` | Committee | Cancels the snooze early: Returns someone to the rotation. |
| `/welcome stats` | Anyone | Shows join count, reach-out rate, reply rate, and intro-post rate for the last 30 days. |
| `/welcome stats DAYS` | Anyone | Shows the same stats for the last DAYS days. |

Discord still lists every command for everyone, so a non-committee member who tries a restricted one gets a private "committee members only" reply that nobody else in the channel sees.

There is no command for adding or removing a greeter. Committee membership is managed outside this bot: the bot only reads the Welcome Committee role and never adds or removes it. To add or remove someone, assign or unassign that role in Discord (by hand, or however your server hands out roles). The rotation picks up the change on its own.

## Dev setup and basic file setup

- MS Windows.
- Open VS Code.
- Open a terminal inside VS Code (assumed to be powershell)
- Run these commands:

```powershell
winget install OpenJS.NodeJS.LTS
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
node --version
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

## Watching the introductions channel

When the bot posts a welcome prompt, it records the new member's user ID alongside that message. Then it watches the introductions channel for the first time that new member posts there, at which point it replies to its own original welcome prompt message in the Welcome Committee channel:

```text
📝 @Greeter @Newcomer just posted in #👋-introductions for the first time — https://discord.com/channels/...
```

The point of that ping is so the greeter is aware someone they greeted has introduced themselves, so the greeter can go reply to the introduction message, if they so choose, to add that personal touch.

Notes on how it behaves:

- Matching is by user ID, not by name, so a nickname or username change doesn't break it.
- Only the first post is announced. Everything that member posts after that is ignored.
- It only knows about people who joined while the bot was running -- a join is what creates the record. Someone who joined while the bot was down gets no announcement, because there's nothing to match against.
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

- Only reactions from people who hold the Welcome Committee role count towards stats. If someone without the role clicks ✅, nothing is recorded. (Ideally members without the Welcome Committee role wouldn't have access to the channel anyway.)

- Only reactions on the bot's own welcome messages count. Reacting to some other message in the channel isn't counted.

- The bot pre-adds ✅ and 🗨 to its own messages so Welcome Committee members don't have to search for the emoji. Neither of its own pre-added reactions counts towards anything -- the bot ignores reactions from any bot, including itself, so a stat only moves when a human on the committee clicks the emoji.


## Weekly summary

Once a week the bot posts a summary of the last 7 days to the Welcome Committee channel, in the same format as `/welcome stats`. Nobody has to trigger it.

By default it posts Mondays at 9am, in the local time of the machine running the bot -- not in any Discord member's own timezone. If the bot isn't running at that moment it posts the next time it is running later that same day; if it's down all day it skips that week. It posts at most once a day.

The day and hour are the WEEKLY_DAY and WEEKLY_HOUR settings at the top of ncaau-discord-welcome-bot.js.
