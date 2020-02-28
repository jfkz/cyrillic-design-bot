const Composer = require('telegraf/composer')
const session = require('telegraf/session')
const updateLogger = require('telegraf-update-logger')
const https = require('https')
const fs = require("fs")
const path = require("path")

const mainFile = process.env.DATA_FOLDER + '/_data.json'

const COMMANDS = {
  REMOVE: 'delete',
  UPDATE: 'update',
  FAV: 'fav',
  UNFAV: 'unfav'
}

const bot = new Composer()

bot.use(updateLogger({ colors: true }))
bot.use(session())

bot.start(({ reply }) => reply('Welcome message'))
bot.help(({ reply }) => reply('Help message'))
bot.settings(({ reply }) => reply('Bot settings'))

bot.command('date', ({ reply }) => reply(`Server time: ${Date()}`))

bot.command('myid', ({ from, reply }) => reply(`Your id: ${from.id}`))

bot.command([
  COMMANDS.REMOVE,
  COMMANDS.UPDATE,
  COMMANDS.FAV,
  COMMANDS.UNFAV
], (ctx) => {
  ctx.session.last_command = ctx.message.text.replace('/', '')
})

bot.on('message', async (ctx) => {
  if (ctx.session.last_command) {
    let last_command = ctx.session.last_command
    let message = ctx.message
    if (message.forward_from_chat
      && message.forward_from_chat.id
      && message.forward_from_chat.id == process.env.CHANNEL_ID) {
        await updatePost({ telegram: ctx.telegram, post: message, command: ctx.session.last_command })
        updateFiles()
        // ctx.telegram.deleteMessage(message.message_id)
        ctx.reply("Пост обновлен")
    }
    ctx.session.last_command = undefined
  }
})

bot.use(({ channelPost, editedChannelPost, reply, telegram, deleteMessage }) => {
  let post = channelPost || editedChannelPost
  if (post) {
    if (post.chat.id == process.env.CHANNEL_ID) {
      if (post.photo) {
        updatePost({telegram, post})
        updateFiles()
      }
    }
    if (post.text == '/getid') {
      let admins = process.env.ADMIN_IDS.split(',')
      for (var id in admins) {
        telegram.sendMessage(admins[id], `Channel id: ${post.chat.id}`)
      }
      deleteMessage(post.message_id)
    }
  }
})

function updateFiles() {
  if (fs.existsSync(mainFile)) {
    let rawdata = fs.readFileSync(mainFile)
    mainData = JSON.parse(rawdata)

    // some shit

    return true
  }
  return false
}

async function updatePost({telegram, post, command}) {
  command = command || COMMANDS.UPDATE
  const message_id = post.forward_from_message_id || post.message_id
  if (!post || !post.photo) { return }
  let mainData = {}
  if (!fs.existsSync(process.env.DATA_FOLDER)) {
    fs.mkdirSync(process.env.DATA_FOLDER)
  }
  if (fs.existsSync(mainFile)) {
    let rawdata = fs.readFileSync(mainFile)
    mainData = JSON.parse(rawdata)
  }
  let file_name = await downloadFile({
    telegram: telegram,
    file_id: post.photo[0].file_id,
    file_name: message_id
  })
  const { title, tags, url } = prepareData(post)
  let isRemoved     = command == COMMANDS.REMOVE ? true : (mainData[message_id] && mainData[message_id].isRemoved || false)
  let isHighlighted = command == COMMANDS.FAV || command == COMMANDS.UNFAV ? command == COMMANDS.FAV : (mainData[message_id] && mainData[message_id].isHighlighted || false)
  mainData[message_id] = {
    id: message_id,
    title: title,
    image: `images/${file_name}`,
    tags: tags,
    url: url,
    date: post.date,
    edit_date: post.edit_date,
    isHighlighted: isHighlighted,
    isRemoved: isRemoved
  }
  let data = JSON.stringify(mainData)
  fs.writeFileSync(mainFile, data)
}

function prepareData(post) {
  let caption = post.caption
  if (!caption) { return { title: "", tags: "", url: "" } }
  let tags = []
  let url = ""
  let title = caption
  for (var id in post.caption_entities) {
    let entity = post.caption_entities[id]
    switch (entity.type) {
      case "url":
        url = caption.slice(entity.offset, entity.length + entity.offset)
        title = title.replace(url, "")
        break
      case "hashtag":
        let tag = caption.slice(entity.offset + 1, entity.length + entity.offset)
        tags.push(tag)
        title = title.replace(`#${tag}`, "")
        break
    }
  }
  return {
    url: url,
    tags: tags,
    title: title.trim()
  }
}

async function downloadFile({ telegram, file_id, file_name}) {
  if (!fs.existsSync(process.env.IMAGES_FOLDER)) {
    fs.mkdirSync(process.env.IMAGES_FOLDER)
  }
  const link = await telegram.getFileLink(file_id)
  const ext = path.extname(link)
  file_name = file_name + ext
  const file = fs.createWriteStream(process.env.IMAGES_FOLDER + '/' + file_name)
  const request = https.get(link, function(response) { response.pipe(file) })
  return file_name
}


module.exports = bot
