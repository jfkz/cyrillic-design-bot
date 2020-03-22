[![Codacy Badge](https://api.codacy.com/project/badge/Grade/e69578f347274eaaaa858f385dfed285)](https://app.codacy.com/gh/cyrillic-design/copy-bot?utm_source=github.com&utm_medium=referral&utm_content=cyrillic-design/copy-bot&utm_campaign=Badge_Grade_Dashboard)
[![Build Status](https://travis-ci.com/cyrillic-design/copy-bot.svg?branch=master)](https://travis-ci.com/cyrillic-design/copy-bot)

# Copy bot

The bot that control them all.

## Usage

1. Create `.env.local` with your settings
2. Run one of this sequences:

```sh
$ npm install
$ npm run dev
```

```sh
$ yarn
$ yarn dev
```

## Lint

You can use `git config core.hooksPath .githooks` command to enable autolinting before commit.


## Heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

Setup Heroku variables:
* `ADMIN_IDS` - Telegram IDs of channel admins
* `CHANNEL_ID` - channel id for auto-deploy
* `WEBHOOK_URL` - Something like: https://cyrillic-design-bot.herokuapp.com/
* `BOT_TOKEN` - Telegram token from [BotFather](https://t.me/botfather)
