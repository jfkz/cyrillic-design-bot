const Composer = require('telegraf/composer')
const session = require('telegraf/session')
const updateLogger = require('telegraf-update-logger')
const https = require('https')
const fs = require("fs")
const path = require("path")
const cyrillicToTranslit = require('cyrillic-to-translit-js')
const lockFile = require('lockfile')
const { exec } = require('child_process')
const countFiles = require('count-files')

const mainFile = process.env.DATA_FOLDER + '/_data.json'
const lock_file = process.env.DATA_FOLDER + '/.lock'

const COMMANDS = {
  REMOVE: 'delete',
  UPDATE: 'update',
  FAV: 'fav',
  UNFAV: 'unfav'
}

const bot = new Composer()

bot.use(updateLogger({ colors: true }))
bot.use(session())

bot.start(({ reply }) => reply('Привет! Я бот, который публикует посты с каналов на сайтах.'))
bot.help(({ reply }) =>
  reply('Отправь мне форвард с канала, чтобы я мог опубликовать его. Или просто добавь в свой канал и я буду всё делать автоматически.')
)
bot.settings(({ reply }) => reply('Bot settings'))

bot.command('date', ({ reply }) => reply(`Server time: ${Date()}`))

bot.command('myid', ({ from, reply }) => {
  reply(`Your id: ${from.id}`)
})

bot.command('commit', async ({ from, reply }) => {
  if (isAdmin(from.id)) {
    if (await updateFiles()) {
      reply("Сделан коммит")
    }
  }
})

bot.command([
  COMMANDS.REMOVE,
  COMMANDS.UPDATE,
  COMMANDS.FAV,
  COMMANDS.UNFAV
], (ctx) => {
  ctx.session.last_command = ctx.message.text.replace('/', '')
})

bot.on('message', async (ctx) => {
  ctx.session.last_command = ctx.session.last_command || COMMANDS.UPDATE
  if (ctx.session.last_command) {
    let last_command = ctx.session.last_command
    let message = ctx.message
    if (message.forward_from_chat
      && message.forward_from_chat.id
      && message.forward_from_chat.id == process.env.CHANNEL_ID) {
        await updatePost({ telegram: ctx.telegram, post: message, command: ctx.session.last_command })
        if (await updateFiles()) {
          ctx.reply(`Пост обновлен #${message.forward_from_message_id}`)
        } else {
          ctx.reply(`Пост добавлен #${message.forward_from_message_id}`)
        }
    } else {
      ctx.reply("Бот принимает только форварды сообщений от администраторов")
    }
    ctx.session.last_command = undefined
  }
})

bot.use(async ({ channelPost, editedChannelPost, reply, telegram, deleteMessage }) => {
  let post = channelPost || editedChannelPost
  if (post) {
    if (post.chat.id == process.env.CHANNEL_ID) {
      if (post.photo) {
        await updatePost({telegram, post})
        await updateFiles()
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

function isAdmin(from_id) {
  let admins = process.env.ADMIN_IDS.split(',')
  for (var id in admins) { if (admins[id] == from_id) { return true } }
  return false
}

async function updateFiles() {

  function writeFiles(file_mask, data) {
    data.sort((a, b) => b.id - a.id)
    const file_size = process.env.PAGE_SIZE
    if (data.length < file_size) {
      let jsonData = JSON.stringify(data)
      fs.writeFileSync(`${file_mask}-1.json`, jsonData)
    } else {
      let page = 1
      while (page <= Math.ceil(data.length / file_size)) {
        fs.writeFileSync(`${file_mask}-${page}.json`, JSON.stringify(
            data.slice((page - 1) * file_size, page * file_size)
          )
        )
        page++
      }
    }
  }


  while(lockFile.checkSync(lock_file)) { await new Promise(r => setTimeout(r, 2000)) }
  lockFile.lockSync(lock_file)

  let result = false
  if (fs.existsSync(mainFile)) {
    let rawdata = fs.readFileSync(mainFile)
    mainData = JSON.parse(rawdata)
    let tagDataUnordered = {}
    let tagSlugs = []
    let acceptedData = []
    for (let id in mainData) {
      let post = mainData[id]
      if (post.isRemoved) { return }
      acceptedData.push(post)
      for (let tag_id in post.tags) {
        let tagText = post.tags[tag_id]
        let tag = cyrillicToTranslit().transform(tagText, "_").toLowerCase()
        if (!tagDataUnordered[tag]) { tagDataUnordered[tag] = [] }
        tagDataUnordered[tag].push(post)
        tagSlugs[tag] = tagText
      }
    }
    // Pages
    writeFiles(process.env.DATA_FOLDER + '/page', Object.values(acceptedData))
    // Tags: sort
    let tagData = {}
    Object.keys(tagDataUnordered).sort().forEach(function(key) {
      tagData[key] = tagDataUnordered[key]
      writeFiles(process.env.DATA_FOLDER + `/tags-${key}`, tagDataUnordered[key])
    })
    // Tags: make file
    let tagsForFile = []
    for (let slug in tagSlugs) {
      tagsForFile.push({ title: tagSlugs[slug], slug: slug })
    }
    fs.writeFileSync(process.env.DATA_FOLDER + '/tags.json', JSON.stringify(tagsForFile))

    const run = process.env.RUN_COMMAND.replace('%s', `upd: new data from bot. date: ` + (new Date()).toString().toLowerCase())
    await exec(run)
    // Pages
    result = true
  }
  lockFile.unlockSync(lock_file)
  return result
}

async function updatePost({telegram, post, command}) {
  while(lockFile.checkSync(lock_file)) { await new Promise(r => setTimeout(r, 2000)) }
  lockFile.lockSync(lock_file)
  command = command || COMMANDS.UPDATE
  const message_id = post.forward_from_message_id || post.message_id
  const date = post.forward_date || post.date
  const edit_date = post.forward_from_message_id ? post.date : post.edit_date
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
    file_id: post.photo.pop().file_id,
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
    date: date,
    edit_date: edit_date,
    isHighlighted: isHighlighted,
    isRemoved: isRemoved
  }
  let data = JSON.stringify(mainData)
  fs.writeFileSync(mainFile, data)
  lockFile.unlockSync(lock_file)
}

function prepareData(post) {
  let caption = post.caption
  if (!caption) { return { title: "", tags: "", url: "" } }
  let tags = []
  let url = ""
  let title = caption.replace(/@(.*)|♡|☆/ig, '')
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
