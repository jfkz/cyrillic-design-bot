const Composer = require('telegraf/composer')
const session = require('telegraf/session')
const updateLogger = require('telegraf-update-logger');

const bot = new Composer()

bot.use(updateLogger({ colors: true }));
bot.use(session())

bot.start(({ reply }) => reply('Welcome message'))
bot.help(({ reply }) => reply('Help message'))
bot.settings(({ reply }) => reply('Bot settings'))

bot.command('date', ({ reply }) => reply(`Server time: ${Date()}`))

bot.on('message', (ctx) => {
  console.log(ctx)
})

bot.use((ctx) => {
    let chat = ctx.channelPost.chat
    console.log('from channel')
    console.log(ctx)

    // ctx.telegram.forwardMessage(`@${chat.username}`, '@example', MESSAGE_ID)
})

module.exports = bot
